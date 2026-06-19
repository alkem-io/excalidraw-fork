import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  ELEMENTS,
  FILES,
  APPSTATE,
  APPSTATE_ALLOW_LIST,
  BINDING_ORIGIN,
  elementToYMap,
  yMapToElement,
} from "./schema";
import { keysBetween, orderByIndex, repairIndices } from "./order";
import { readFiles } from "./files";

import type * as Y from "yjs";

import type { ElementRecord } from "./schema";

/**
 * Lossless `Excalidraw-JSON ↔ Y.Doc` round-trip (FR-B-010, data-model §6). The
 * WS-E migration consumes `populateYDoc`; this package owns its correctness, not
 * its scheduling.
 */

export type SceneJSON = {
  elements: ElementRecord[];
  files?: BinaryFiles;
  appState?: Record<string, unknown>;
};

/**
 * Write every element (tombstones included) into the scene `Y.Map`, files into
 * the files `Y.Map`, and the appState allow-list into the appState `Y.Map`.
 * Missing/invalid `index` values are repaired (data-model §6 rule 3) — the only
 * case where order may legitimately change vs a malformed source. Writes happen
 * under `BINDING_ORIGIN` so a live binding does not echo the load.
 */
export const populateYDoc = (sceneJSON: SceneJSON, ydoc: Y.Doc): Y.Doc => {
  const elementsMap = ydoc.getMap<Y.Map<unknown>>(ELEMENTS);
  const filesMap = ydoc.getMap<BinaryFileData>(FILES);
  const appStateMap = ydoc.getMap<unknown>(APPSTATE);

  // Repair indices on a working copy first (pure), then seed the doc.
  const working: ElementRecord[] = sceneJSON.elements.map((el) => ({ ...el }));
  seedMissingIndices(working);
  const { ordered } = repairIndices(working);

  ydoc.transact(() => {
    for (const element of ordered) {
      elementsMap.set(element.id as string, elementToYMap(element));
    }
    if (sceneJSON.files) {
      for (const [id, file] of Object.entries(sceneJSON.files)) {
        filesMap.set(id, file);
      }
    }
    if (sceneJSON.appState) {
      for (const key of APPSTATE_ALLOW_LIST) {
        const value = sceneJSON.appState[key];
        if (value !== undefined) {
          appStateMap.set(key, value);
        }
      }
    }
  }, BINDING_ORIGIN);

  return ydoc;
};

/**
 * Read the doc back into an Excalidraw scene (ordered by `index`), inverting
 * `populateYDoc`. Tombstones are carried through unchanged.
 */
export const exportSceneJSON = (ydoc: Y.Doc): Required<SceneJSON> => {
  const elementsMap = ydoc.getMap<Y.Map<unknown>>(ELEMENTS);
  const filesMap = ydoc.getMap<BinaryFileData>(FILES);
  const appStateMap = ydoc.getMap<unknown>(APPSTATE);

  const elements: ElementRecord[] = [];
  for (const [id, ymap] of elementsMap.entries()) {
    const element = yMapToElement(ymap);
    element.id = id;
    elements.push(element);
  }

  const appState: Record<string, unknown> = {};
  for (const key of APPSTATE_ALLOW_LIST) {
    if (appStateMap.has(key)) {
      appState[key] = appStateMap.get(key);
    }
  }

  return {
    elements: orderByIndex(elements),
    files: readFiles(filesMap),
    appState,
  };
};

/**
 * Assign provisional fractional indices to elements that have none, preserving
 * the source array order, before the deterministic `repairIndices` pass.
 *
 * A no-index element is seeded BETWEEN its nearest already-indexed (or
 * already-seeded) neighbours in array order, so it keeps the z-position the
 * source array implies. The previous implementation only seeded when EVERY
 * element lacked an index; a PARTIAL-missing set was left with `null` indices,
 * and `orderByIndex` sinks null-index elements to the end — so a front element
 * with no index (e.g. `X, Y(no idx), Z` → `X, Z, Y`) was silently reordered to
 * the back (Fix #4).
 */
const seedMissingIndices = (elements: ElementRecord[]): void => {
  const n = elements.length;
  let i = 0;
  while (i < n) {
    if (readIndexOf(elements[i]) != null) {
      i++;
      continue;
    }
    // contiguous run of missing indices [i, j)
    let j = i;
    while (j < n && readIndexOf(elements[j]) == null) {
      j++;
    }
    const lower = i > 0 ? readIndexOf(elements[i - 1]) : null;
    const upper = j < n ? readIndexOf(elements[j]) : null;
    const runLength = j - i;
    let keys: string[];
    try {
      keys = keysBetween(lower, upper, runLength);
    } catch {
      // Source bounds were not strictly increasing (malformed input). Seed above
      // the lower bound only; `repairIndices` afterwards makes the order strictly
      // increasing again. Preserves array order within the run.
      keys = keysBetween(lower, null, runLength);
    }
    for (let k = 0; k < runLength; k++) {
      elements[i + k].index = keys[k];
    }
    i = j;
  }
};

const readIndexOf = (el: ElementRecord): string | null => {
  const idx = el.index;
  return typeof idx === "string" ? idx : null;
};
