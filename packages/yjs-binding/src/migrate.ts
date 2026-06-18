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
 * Assign provisional sequential indices to elements that have none, preserving
 * the source array order, before the deterministic `repairIndices` pass. This
 * keeps a source scene with entirely missing indices in its given order.
 */
const seedMissingIndices = (elements: ElementRecord[]): void => {
  const missingCount = elements.filter((el) => el.index == null).length;
  if (missingCount === 0) {
    return;
  }
  // If ALL are missing, distribute keys across the whole space in array order.
  if (missingCount === elements.length) {
    const keys = keysBetween(null, null, elements.length);
    elements.forEach((el, i) => {
      el.index = keys[i];
    });
  }
  // Partial-missing is handled by repairIndices afterwards.
};
