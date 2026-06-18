import * as Y from "yjs";

import type { BoundElement } from "@excalidraw/element/types";

import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";

import { diffFiles } from "./files";
import { keyBetween } from "./order";
import {
  APPSTATE_ALLOW_LIST,
  BINDING_ORIGIN,
  BOUND_ELEMENTS_KEY,
  JSON_LEAF_KEYS,
  deepEqual,
  elementToYMap,
  writeChangedKeys,
} from "./schema";

import type { BoundElementType, ElementRecord } from "./schema";

/**
 * The onChange → Yjs write path (data-model §8 Diff). Translates an Excalidraw
 * `onChange(elements, appState, files)` into the minimal set of per-property Yjs
 * mutations, batched in a single `BINDING_ORIGIN`-tagged transaction.
 */

/**
 * Cheap change gate (T006): compare `(id, version)` pairs of the previous and
 * next element arrays. Returns `true` when nothing changed (skip the write).
 * Mirrors y-excalidraw's `areElementsSame` fast path.
 */
export const areElementsSame = (
  prev: readonly ElementRecord[],
  next: readonly ElementRecord[],
): boolean => {
  if (prev.length !== next.length) {
    return false;
  }
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].id !== next[i].id || prev[i].version !== next[i].version) {
      return false;
    }
  }
  return true;
};

/** Index a readonly element array by id for O(1) lookup. */
const byId = (
  elements: readonly ElementRecord[],
): Map<string, ElementRecord> => {
  const map = new Map<string, ElementRecord>();
  for (const element of elements) {
    map.set(element.id as string, element);
  }
  return map;
};

export type DiffRoots = {
  ydoc: Y.Doc;
  elementsMap: Y.Map<Y.Map<unknown>>;
  filesMap: Y.Map<BinaryFileData>;
  appStateMap: Y.Map<unknown>;
};

/**
 * Compute and apply the per-property delta between `prev` and `next` element
 * arrays, plus the files and appState allow-list deltas, in ONE origin-tagged
 * transaction (T007/T008, FR-B-002).
 *
 * - existing element → only changed keys (`writeChangedKeys`); `boundElements`
 *   diffs into its nested `Y.Map`.
 * - new element → a fresh element `Y.Map` with all keys; if it has no `index`,
 *   one is generated between its ordered neighbours via `keyBetween`.
 * - element removed from the array → tombstone (`isDeleted = true`); the element
 *   `Y.Map` is NEVER deleted from the scene map (FR-B-006).
 *
 * Returns the number of element keys / file / appState mutations written (0 ⇒ no
 * transaction was emitted).
 */
export const writeDiff = (
  roots: DiffRoots,
  prev: readonly ElementRecord[],
  next: readonly ElementRecord[],
  appState?: Pick<AppState, "viewBackgroundColor"> & { name?: string },
  files?: BinaryFiles,
): number => {
  const { ydoc, elementsMap, filesMap, appStateMap } = roots;
  const prevById = byId(prev);
  const nextById = byId(next);

  // Pre-compute fractional indices for any new element that arrives without one,
  // using its position in the INPUT array (where the editor placed it — a null
  // index has no sortable position of its own). Done outside the transaction
  // (pure string math) so the transaction body stays minimal.
  const generatedIndex = new Map<string, string>();
  for (let i = 0; i < next.length; i++) {
    const el = next[i];
    if (el.index == null && !elementsMap.has(el.id as string)) {
      // neighbour bounds from already-resolved indices around it in array order
      const prevIndex = findPrevIndex(next, i, generatedIndex);
      const nextIndex = findNextIndex(next, i, generatedIndex);
      generatedIndex.set(el.id as string, keyBetween(prevIndex, nextIndex));
    }
  }

  // Cheap pre-pass: decide whether ANY mutation is needed before opening a
  // transaction. Yjs fires `afterTransaction` even for empty transactions, so a
  // no-op `onChange` must NOT call `ydoc.transact` at all (SC-B-003).
  if (!hasDiffWork(roots, prevById, nextById, next, appState, files)) {
    return 0;
  }

  let writes = 0;
  ydoc.transact(() => {
    // upserts (existing changed + new)
    for (const element of next) {
      const id = element.id as string;
      const existing = elementsMap.get(id);
      if (existing) {
        writes += writeChangedKeys(existing, element);
      } else {
        const seeded: ElementRecord = { ...element };
        if (seeded.index == null) {
          seeded.index = generatedIndex.get(id) ?? keyBetween(null, null);
        }
        elementsMap.set(id, elementToYMap(seeded));
        writes++;
      }
    }

    // removals → tombstone (never Y.Map.delete)
    for (const [id, prevEl] of prevById) {
      if (!nextById.has(id)) {
        const ymap = elementsMap.get(id);
        if (ymap && ymap.get("isDeleted") !== true) {
          ymap.set("isDeleted", true);
          ymap.set(
            "version",
            (((prevEl.version as number) ?? 0) + 1) as number,
          );
          writes++;
        }
      }
    }

    // files
    if (files) {
      writes += diffFiles(filesMap, files);
    }

    // appState allow-list (OPEN-2): viewBackgroundColor + name
    if (appState) {
      writes += writeAppState(appStateMap, appState);
    }
  }, BINDING_ORIGIN);

  return writes;
};

const findPrevIndex = (
  ordered: readonly ElementRecord[],
  i: number,
  generated: Map<string, string>,
): string | null => {
  for (let k = i - 1; k >= 0; k--) {
    const el = ordered[k];
    const idx = (el.index as string | null) ?? generated.get(el.id as string);
    if (idx != null) {
      return idx;
    }
  }
  return null;
};

const findNextIndex = (
  ordered: readonly ElementRecord[],
  i: number,
  generated: Map<string, string>,
): string | null => {
  for (let k = i + 1; k < ordered.length; k++) {
    const el = ordered[k];
    const idx = (el.index as string | null) ?? generated.get(el.id as string);
    if (idx != null) {
      return idx;
    }
  }
  return null;
};

/**
 * Diff the `APPSTATE` allow-list (`viewBackgroundColor`, `name`) against the
 * `appState` `Y.Map` (OPEN-2). Already inside the diff transaction. Returns the
 * number of keys written.
 */
export const writeAppState = (
  appStateMap: Y.Map<unknown>,
  appState: Record<string, unknown>,
): number => {
  let writes = 0;
  for (const key of APPSTATE_ALLOW_LIST) {
    const next = appState[key];
    if (next === undefined) {
      continue;
    }
    if (appStateMap.get(key) !== next) {
      appStateMap.set(key, next);
      writes++;
    }
  }
  return writes;
};

/**
 * Read-only pre-pass: returns `true` iff `writeDiff` would mutate anything.
 * Used to avoid opening an empty transaction for a no-op `onChange` (a no-op must
 * emit zero transactions — SC-B-003).
 */
const hasDiffWork = (
  roots: DiffRoots,
  prevById: Map<string, ElementRecord>,
  nextById: Map<string, ElementRecord>,
  next: readonly ElementRecord[],
  appState?: Record<string, unknown>,
  files?: BinaryFiles,
): boolean => {
  const { elementsMap, filesMap, appStateMap } = roots;

  // new / changed elements
  for (const element of next) {
    const id = element.id as string;
    const existing = elementsMap.get(id);
    if (!existing) {
      return true; // new element
    }
    if (elementChanged(existing, element)) {
      return true;
    }
  }

  // removals (need a tombstone)
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) {
      const ymap = elementsMap.get(id);
      if (ymap && ymap.get("isDeleted") !== true) {
        return true;
      }
    }
  }

  // files
  if (files) {
    const nextIds = new Set(Object.keys(files));
    for (const id of filesMap.keys()) {
      if (!nextIds.has(id)) {
        return true;
      }
    }
    for (const id of nextIds) {
      if (!deepEqual(filesMap.get(id), files[id])) {
        return true;
      }
    }
  }

  // appState allow-list
  if (appState) {
    for (const key of APPSTATE_ALLOW_LIST) {
      const value = appState[key];
      if (value !== undefined && appStateMap.get(key) !== value) {
        return true;
      }
    }
  }

  return false;
};

/** Whether any per-property key of `element` differs from its `Y.Map`. */
const elementChanged = (
  ymap: Y.Map<unknown>,
  element: ElementRecord,
): boolean => {
  for (const key of Object.keys(element)) {
    const next = element[key];
    if (next === undefined) {
      continue;
    }
    if (key === BOUND_ELEMENTS_KEY) {
      if (boundElementsChanged(ymap, next as readonly BoundElement[] | null)) {
        return true;
      }
      continue;
    }
    const prev = ymap.get(key);
    if (JSON_LEAF_KEYS.has(key)) {
      if (!deepEqual(prev, next)) {
        return true;
      }
    } else if (prev !== next) {
      return true;
    }
  }
  return false;
};

/** Whether the nested boundElements map would change for this element. */
const boundElementsChanged = (
  ymap: Y.Map<unknown>,
  boundElements: readonly BoundElement[] | null,
): boolean => {
  const nested = ymap.get(BOUND_ELEMENTS_KEY);
  const nextMap = new Map<string, BoundElementType>();
  if (boundElements) {
    for (const b of boundElements) {
      nextMap.set(b.id, b.type);
    }
  }
  if (!(nested instanceof Y.Map)) {
    return nextMap.size > 0;
  }
  if (nested.size !== nextMap.size) {
    return true;
  }
  for (const [id, type] of nextMap) {
    if (nested.get(id) !== type) {
      return true;
    }
  }
  return false;
};
