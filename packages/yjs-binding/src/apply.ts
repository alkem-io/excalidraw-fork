import { CaptureUpdateAction } from "@excalidraw/element";

import type {
  AppState,
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { BINDING_ORIGIN, APPSTATE_ALLOW_LIST, yMapToElement } from "./schema";
import { orderByIndex, repairIndices } from "./order";
import { readFiles } from "./files";

import type * as Y from "yjs";
import type { ElementRecord } from "./schema";

/**
 * The Yjs observe → scene apply path (data-model §8 Apply). Reads the changed
 * portion of the doc, rebuilds only the affected elements, repairs ordering,
 * filters tombstones for render, and calls `updateScene` without disturbing
 * local selection/zoom/scroll.
 */

export type ApplyRoots = {
  ydoc: Y.Doc;
  elementsMap: Y.Map<Y.Map<unknown>>;
  filesMap: Y.Map<BinaryFileData>;
  appStateMap: Y.Map<unknown>;
};

/** Hook telling apply which element id (if any) the local user is mid-editing. */
export type EditingGuard = () => string | null;

/** A simple random-ish nonce for the local version bump (OPEN-3). */
const randomNonce = (): number => Math.floor(Math.random() * 2 ** 31);

/**
 * Build the full element list from the doc's element maps, ordered by `index`
 * with collision repair (T012–T014). Tombstones are retained in the returned
 * list (the caller filters them for render); `repaired` carries the ids whose
 * `index` was changed so the caller can persist the repair under
 * `BINDING_ORIGIN`.
 *
 * `prevById` supplies the previous local element objects so that
 * `version`/`versionNonce` can be bumped locally on a real per-property change
 * (OPEN-3) rather than carried verbatim from the remote.
 */
export const buildElements = (
  elementsMap: Y.Map<Y.Map<unknown>>,
  prevById: Map<string, ElementRecord>,
): { elements: ElementRecord[]; repaired: Set<string> } => {
  const elements: ElementRecord[] = [];
  for (const [id, ymap] of elementsMap.entries()) {
    const next = yMapToElement(ymap);
    next.id = id;
    bumpVersion(next, prevById.get(id));
    elements.push(next);
  }
  const { ordered, repaired } = repairIndices(elements);
  return { elements: ordered, repaired };
};

/**
 * Recompute `version`/`versionNonce` locally when the materialized element
 * differs from the previous local one (OPEN-3) — keeps Excalidraw's version
 * monotonic and `hashElementsVersion()` change-detection meaningful. When the
 * element is unchanged, the previous version/nonce are preserved (no churn).
 */
const bumpVersion = (
  next: ElementRecord,
  prev: ElementRecord | undefined,
): void => {
  if (!prev) {
    // first time we see this element locally — keep whatever version it carries
    if (typeof next.version !== "number") {
      next.version = 1;
    }
    if (typeof next.versionNonce !== "number") {
      next.versionNonce = randomNonce();
    }
    return;
  }
  // compare every key except the version metadata itself
  let changed = false;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === "version" || key === "versionNonce" || key === "updated") {
      continue;
    }
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      changed = true;
      break;
    }
  }
  if (changed) {
    next.version = ((prev.version as number) ?? 0) + 1;
    next.versionNonce = randomNonce();
    next.updated = Date.now();
  } else {
    next.version = prev.version;
    next.versionNonce = prev.versionNonce;
    next.updated = prev.updated;
  }
};

/** Read the synced `APPSTATE` allow-list from the doc (OPEN-2). */
export const readAppState = (
  appStateMap: Y.Map<unknown>,
): Partial<Pick<AppState, "viewBackgroundColor"> & { name: string }> => {
  const result: Record<string, unknown> = {};
  for (const key of APPSTATE_ALLOW_LIST) {
    if (appStateMap.has(key)) {
      result[key] = appStateMap.get(key);
    }
  }
  return result;
};

export type ApplyDeps = {
  roots: ApplyRoots;
  api: Pick<
    ExcalidrawImperativeAPI,
    "updateScene" | "addFiles" | "getFiles" | "getSceneElementsIncludingDeleted"
  >;
  /** returns the previous full element list applied (for version-bump compare) */
  getPrevElements: () => readonly ElementRecord[];
  /** id of the element the local user is mid-editing, or null */
  editingGuard?: EditingGuard;
};

/**
 * Apply the current doc state to the scene (T011–T016). Caller has already
 * confirmed the triggering transaction is NOT ours (echo guard lives in the
 * observer wiring in index.ts, but we re-assert it where a transaction is
 * available). Returns the element list applied.
 */
export const applyToScene = (deps: ApplyDeps): ElementRecord[] => {
  const { roots, api, getPrevElements, editingGuard } = deps;
  const { ydoc, elementsMap, filesMap, appStateMap } = roots;

  const prevElements = getPrevElements();
  const prevById = new Map<string, ElementRecord>(
    prevElements.map((el) => [el.id as string, el]),
  );

  const { elements, repaired } = buildElements(elementsMap, prevById);

  // Persist index-collision repairs back into the doc under our origin so they
  // are treated as a local change (not echoed) and converge across replicas.
  if (repaired.size > 0) {
    ydoc.transact(() => {
      for (const el of elements) {
        if (repaired.has(el.id as string)) {
          const ymap = elementsMap.get(el.id as string);
          if (ymap && ymap.get("index") !== el.index) {
            ymap.set("index", el.index);
          }
        }
      }
    }, BINDING_ORIGIN);
  }

  // Editing guard (FR-B-013): keep the LIVE local copy of an element the user is
  // mid-editing (read from the editor's scene, which holds the in-progress edit)
  // instead of replacing it from the remote.
  const editingId = editingGuard ? editingGuard() : null;
  let applied = elements;
  if (editingId) {
    const liveLocal = api
      .getSceneElementsIncludingDeleted()
      .find((el) => (el as ElementRecord).id === editingId) as
      | ElementRecord
      | undefined;
    const localEditing = liveLocal ?? prevById.get(editingId);
    if (localEditing) {
      applied = elements.map((el) => (el.id === editingId ? localEditing : el));
    }
  }

  // Files: add any new binaries the editor doesn't have yet.
  const docFiles = readFiles(filesMap);
  const existingFiles = api.getFiles();
  const newFiles: BinaryFileData[] = [];
  for (const id of Object.keys(docFiles)) {
    if (!existingFiles[id]) {
      newFiles.push(docFiles[id]);
    }
  }
  if (newFiles.length > 0) {
    api.addFiles(newFiles);
  }

  // Render set excludes tombstones; the full set (incl. tombstones) is what we
  // hand to updateScene so the soft-delete state is preserved in the scene.
  const renderElements = orderByIndex(applied);

  api.updateScene({
    elements: renderElements as never,
    appState: readAppState(appStateMap) as never,
    captureUpdate: CaptureUpdateAction.NEVER,
  });

  return applied;
};

/** Filter tombstones for callers that need the rendered (non-deleted) set. */
export const nonDeleted = (
  elements: readonly ElementRecord[],
): ElementRecord[] => elements.filter((el) => el.isDeleted !== true);
