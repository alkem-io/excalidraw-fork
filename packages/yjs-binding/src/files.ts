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
 *
 * `protectedIds` (Fix #3) — fileIds still referenced by SOME element in the
 * scene/doc, INCLUDING soft-deleted (tombstoned) image elements. A protected id
 * is NEVER deleted even when it is absent from the `files` arg, because:
 *  - during async image loading `files` is transiently partial (the binary has
 *    not finished loading), so a benign local `onChange` would otherwise delete
 *    a binary the doc still needs; and
 *  - a tombstoned image still references its file, so file lifecycle must follow
 *    element soft-delete, not the live `files` map.
 * When omitted (e.g. the populate path), behaviour is unchanged.
 */
export const diffFiles = (
  filesMap: Y.Map<BinaryFileData>,
  files: BinaryFiles,
  protectedIds?: ReadonlySet<string>,
): number => {
  let mutations = 0;
  const nextIds = new Set(Object.keys(files));

  // removals: ids in the map, not in the next files arg, AND not still
  // referenced by any (incl. tombstoned / not-yet-loaded) element.
  for (const id of [...filesMap.keys()]) {
    if (!nextIds.has(id) && !protectedIds?.has(id)) {
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

/**
 * Collect the set of fileIds referenced by any element — live OR tombstoned.
 * Used to protect binaries from deletion while their referencing element still
 * exists (Fix #3). Reads the `fileId` scalar each image element carries.
 */
export const referencedFileIds = (
  elementsMap: Y.Map<Y.Map<unknown>>,
): Set<string> => {
  const ids = new Set<string>();
  for (const [, ymap] of elementsMap.entries()) {
    const fileId = ymap.get("fileId");
    if (typeof fileId === "string") {
      ids.add(fileId);
    }
  }
  return ids;
};

/** Read the `files` `Y.Map` back into a plain `BinaryFiles` record. */
export const readFiles = (filesMap: Y.Map<BinaryFileData>): BinaryFiles => {
  const files: BinaryFiles = {};
  for (const [id, data] of filesMap.entries()) {
    files[id] = data;
  }
  return files;
};
