import * as Y from "yjs";

import type { BoundElement } from "@excalidraw/element/types";

import { BINDING_ORIGIN } from "./origin";

/**
 * Top-level Yjs root-type names (obtained via `ydoc.getMap(name)`).
 * See data-model §1.
 */
export const ELEMENTS = "elements" as const;
export const FILES = "files" as const;
export const APPSTATE = "appState" as const;

/**
 * The `appState` allow-list synced through the `APPSTATE` `Y.Map` (OPEN-2
 * resolved). Everything else in Excalidraw's appState stays per-client
 * (selection, zoom, scroll, active tool) and is NEVER written to the doc.
 */
export const APPSTATE_ALLOW_LIST = ["viewBackgroundColor", "name"] as const;
export type AppStateAllowKey = typeof APPSTATE_ALLOW_LIST[number];

/**
 * Representation tiering (data-model §4).
 *
 * - **scalars** → plain `Y.Map` value (number / string / boolean / null).
 * - **JSON-leaf** → stored as the whole value (object/array) directly as the Yjs
 *   value; compared by deep value-equality; per-key LWW for the whole blob.
 * - **`boundElements`** → the single nested `Y.Map<id, "arrow"|"text">` add/remove
 *   set (§4.1), the only nested Y type in v1.
 *
 * Keys NOT listed here are scalars. The set is derived from the live element via
 * `Object.keys` (so new upstream scalar fields carry automatically); only the
 * non-scalar keys need explicit classification.
 */
export const JSON_LEAF_KEYS: ReadonlySet<string> = new Set([
  "points",
  "pressures",
  "groupIds",
  "roundness",
  "startBinding",
  "endBinding",
  "fixedSegments",
  "scale",
  "crop",
  "customData",
]);

export const BOUND_ELEMENTS_KEY = "boundElements" as const;

export type BoundElementType = BoundElement["type"];

/** A plain element record as it travels through the binding (mutable copy). */
export type ElementRecord = Record<string, unknown>;

/**
 * Deep value-equality used for the JSON-leaf diff. Order-sensitive for arrays and
 * key-order-insensitive for objects (so it does not depend on the non-canonical
 * JSON byte form — research §5 / data-model §4). `undefined` and a missing key
 * compare equal.
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    // already handled strict-equal above; only one side is nullish here
    return a == null && b == null;
  }
  if (typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) {
    return false;
  }
  if (aIsArr && bIsArr) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) {
      return false;
    }
    if (!deepEqual(aObj[key], bObj[key])) {
      return false;
    }
  }
  return true;
};

/** A structured-clone style deep copy of a JSON-able value (no shared refs). */
const cloneJSON = <T>(value: T): T => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

/**
 * Encode an element's `boundElements` array into a fresh nested `Y.Map` (§4.1).
 * Key = bound id, value = "arrow"|"text". Order is dropped (the fork consumes
 * `boundElements` via `arrayToMap`/`.find`/`.filter`, so order is not semantic).
 */
export const boundElementsToYMap = (
  boundElements: readonly BoundElement[] | null | undefined,
): Y.Map<BoundElementType> => {
  const map = new Y.Map<BoundElementType>();
  if (boundElements) {
    for (const bound of boundElements) {
      map.set(bound.id, bound.type);
    }
  }
  return map;
};

/**
 * Materialize the nested `boundElements` `Y.Map` back into a `BoundElement[]`
 * array (§4.1), applying the "at most one bound text" invariant deterministically
 * on read: if concurrency produced more than one `type:"text"` key, keep the
 * lowest id and drop the extra text bindings. Returns `null` for an empty map so
 * the round-trip matches Excalidraw's `boundElements: null` convention.
 */
export const yMapToBoundElements = (
  map: Y.Map<BoundElementType> | undefined,
): BoundElement[] | null => {
  if (!map || map.size === 0) {
    return null;
  }
  const entries: BoundElement[] = [];
  for (const [id, type] of map.entries()) {
    entries.push({ id, type });
  }
  // Deterministic order independent of Y.Map insertion order, so every replica
  // materializes an identical array (ties already unique by id).
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // "at most one bound text" — keep the lowest id, drop extra text bindings.
  const textIds = entries.filter((e) => e.type === "text").map((e) => e.id);
  if (textIds.length > 1) {
    const keep = textIds[0]; // entries already sorted by id → lowest first
    return entries.filter((e) => e.type !== "text" || e.id === keep);
  }
  return entries;
};

/**
 * Encode a plain Excalidraw element into a fresh per-element `Y.Map` honoring the
 * representation tiering (T003). Keys are derived from the live object via
 * `Object.keys`, so new upstream scalar fields carry automatically.
 *
 * - `boundElements` → nested `Y.Map` (§4.1).
 * - JSON-leaf keys → the value stored directly (deep-cloned to avoid shared refs).
 * - everything else → the scalar value as-is.
 */
export const elementToYMap = (element: ElementRecord): Y.Map<unknown> => {
  const ymap = new Y.Map<unknown>();
  for (const key of Object.keys(element)) {
    const value = element[key];
    if (value === undefined) {
      // Excalidraw omits some optional keys (e.g. customData) — don't store
      // `undefined`, which Yjs treats as a delete and which breaks round-trip
      // "missing key" symmetry.
      continue;
    }
    if (key === BOUND_ELEMENTS_KEY) {
      ymap.set(
        key,
        boundElementsToYMap(value as readonly BoundElement[] | null),
      );
    } else if (JSON_LEAF_KEYS.has(key)) {
      ymap.set(key, cloneJSON(value));
    } else {
      ymap.set(key, value);
    }
  }
  return ymap;
};

/**
 * Decode a per-element `Y.Map` back into a plain Excalidraw element record
 * (T003), inverting `elementToYMap`. JSON-leaf values are deep-cloned so the
 * returned object never aliases doc-internal data; `boundElements` is
 * materialized from its nested `Y.Map`.
 */
export const yMapToElement = (ymap: Y.Map<unknown>): ElementRecord => {
  const element: ElementRecord = {};
  for (const [key, value] of ymap.entries()) {
    if (key === BOUND_ELEMENTS_KEY) {
      element[key] = yMapToBoundElements(value as Y.Map<BoundElementType>);
    } else if (JSON_LEAF_KEYS.has(key)) {
      element[key] = cloneJSON(value);
    } else {
      element[key] = value;
    }
  }
  return element;
};

/**
 * Write the changed per-property keys of `element` into an existing element
 * `Y.Map` (the diff write path, §8). Only keys whose value actually changed are
 * written:
 *
 * - scalars: strict `!==`.
 * - JSON-leaf: `!deepEqual`, value re-stored whole (per-key LWW for the blob).
 * - `boundElements`: diffed into the nested `Y.Map` via `set(id,type)` /
 *   `delete(id)` (§4.1) — add/remove set, never whole-array replace.
 *
 * Keys present on the `Y.Map` but absent from the element are NOT deleted here
 * (deletes are tombstones via `isDeleted`, not key removal — FR-B-006).
 *
 * MUST be called inside a `ydoc.transact(fn, BINDING_ORIGIN)`. Returns the number
 * of keys written (0 ⇒ nothing changed).
 */
export const writeChangedKeys = (
  ymap: Y.Map<unknown>,
  element: ElementRecord,
): number => {
  let writes = 0;
  for (const key of Object.keys(element)) {
    const next = element[key];
    if (next === undefined) {
      continue;
    }
    if (key === BOUND_ELEMENTS_KEY) {
      writes += diffBoundElements(ymap, next as readonly BoundElement[] | null);
      continue;
    }
    const prev = ymap.get(key);
    if (JSON_LEAF_KEYS.has(key)) {
      if (!deepEqual(prev, next)) {
        ymap.set(key, cloneJSON(next));
        writes++;
      }
    } else if (prev !== next) {
      ymap.set(key, next);
      writes++;
    }
  }
  return writes;
};

/**
 * Diff the element's `boundElements` array against the nested `Y.Map`, applying
 * `set`/`delete` for the delta only (§4.1). MUST run inside a
 * `BINDING_ORIGIN` transaction. Returns the number of mutations applied.
 */
export const diffBoundElements = (
  parent: Y.Map<unknown>,
  boundElements: readonly BoundElement[] | null,
): number => {
  let nested = parent.get(BOUND_ELEMENTS_KEY) as
    | Y.Map<BoundElementType>
    | undefined;
  if (!(nested instanceof Y.Map)) {
    // No nested map yet (or a non-map legacy value) — install a fresh one.
    nested = new Y.Map<BoundElementType>();
    parent.set(BOUND_ELEMENTS_KEY, nested);
  }
  const next = new Map<string, BoundElementType>();
  if (boundElements) {
    for (const bound of boundElements) {
      next.set(bound.id, bound.type);
    }
  }
  let mutations = 0;
  // Removes: ids in the map but not in the next array.
  for (const id of [...nested.keys()]) {
    if (!next.has(id)) {
      nested.delete(id);
      mutations++;
    }
  }
  // Adds / type changes: ids in the next array with a new or changed type.
  for (const [id, type] of next) {
    if (nested.get(id) !== type) {
      nested.set(id, type);
      mutations++;
    }
  }
  return mutations;
};

export { BINDING_ORIGIN };
