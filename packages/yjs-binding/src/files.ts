import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

import { deepEqual } from "./schema";

import type * as Y from "yjs";

/**
 * Binary files live in a separate top-level `files` `Y.Map` (FR-B-007),
 * keyed by `fileId` → `BinaryFileData` stored as a JSON-leaf value. Files are
 * large and only ever added/removed (never sub-merged), so they are observed
 * shallowly and kept out of element maps to keep element diffs small.
 */

/**
 * Diff the scene's `files` against the `files` `Y.Map` and apply the delta:
 * append new file ids, update changed ones, remove dropped ones. MUST run inside
 * a `BINDING_ORIGIN` transaction. Returns the number of mutations applied.
 */
export const diffFiles = (
  filesMap: Y.Map<BinaryFileData>,
  files: BinaryFiles,
): number => {
  let mutations = 0;
  const nextIds = new Set(Object.keys(files));

  // removals: ids in the map but no longer referenced
  for (const id of [...filesMap.keys()]) {
    if (!nextIds.has(id)) {
      filesMap.delete(id);
      mutations++;
    }
  }

  // additions / changes
  for (const id of nextIds) {
    const next = files[id];
    const prev = filesMap.get(id);
    if (!prev || !deepEqual(prev, next)) {
      filesMap.set(id, next);
      mutations++;
    }
  }
  return mutations;
};

/** Read the `files` `Y.Map` back into a plain `BinaryFiles` record. */
export const readFiles = (filesMap: Y.Map<BinaryFileData>): BinaryFiles => {
  const files: BinaryFiles = {};
  for (const [id, data] of filesMap.entries()) {
    files[id] = data;
  }
  return files;
};
