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

/**
 * Excalidraw reconciliation metadata that each peer derives **locally** and that
 * is therefore NEVER synced through the doc (OPEN-3, echo-loop fix). If these
 * round-tripped as ordinary LWW scalars, a remote apply would mint a fresh
 * `versionNonce`/`updated`, write them back under `BINDING_ORIGIN`, broadcast,
 * and every peer would re-mint them — an unbounded cross-replica ping-pong.
 *
 * They are excluded from every write path (`elementToYMap`, `writeChangedKeys`),
 * ignored as change signals (`elementChanged`/`hasDiffWork`), and re-derived on
 * apply (`bumpVersion`) from local doc state — deterministically, so re-applying
 * the same doc state is idempotent (no `Math.random()`/`Date.now()`).
 */
export const RECONCILE_META_KEYS: ReadonlySet<string> = new Set([
  "version",
  "versionNonce",
  "updated",
]);

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
 * Given a nested `boundElements` `Y.Map`, return the ids of the *extra* text
 * bindings that violate the "at most one bound text" invariant — every
 * `type:"text"` entry except the lowest id (the keeper). Empty when the
 * invariant already holds. Deterministic on every replica (sorts by id), so the
 * reconciliation it drives converges without flapping (Fix #6).
 */
export const extraBoundTextIds = (
  map: Y.Map<BoundElementType> | undefined,
): string[] => {
  if (!map || map.size === 0) {
    return [];
  }
  const textIds: string[] = [];
  for (const [id, type] of map.entries()) {
    if (type === "text") {
      textIds.push(id);
    }
  }
  if (textIds.length <= 1) {
    return [];
  }
  textIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return textIds.slice(1); // keep the lowest id, the rest are extra
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
    if (RECONCILE_META_KEYS.has(key)) {
      // version/versionNonce/updated are per-peer reconciliation metadata, never
      // synced — each replica derives them locally on apply (OPEN-3).
      continue;
    }
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
 * A property going value → absent on the element (e.g. `link` cleared to
 * `undefined`, or the key dropped entirely) IS removed from the `Y.Map` so a
 * stale value cannot resurrect on the next round-trip (clear semantics). Element
 * *removal* is still a tombstone via `isDeleted`, never wholesale key removal
 * (FR-B-006) — this only clears individual properties of a surviving element.
 *
 * `version`/`versionNonce`/`updated` are never written here (per-peer
 * reconciliation metadata — `RECONCILE_META_KEYS`, OPEN-3).
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
    if (RECONCILE_META_KEYS.has(key)) {
      continue;
    }
    const next = element[key];
    if (next === undefined) {
      // value → absent: clear it from the doc so it can't resurrect. boundElements
      // is handled below via diffBoundElements (which empties the nested map).
      if (key !== BOUND_ELEMENTS_KEY && ymap.has(key)) {
        ymap.delete(key);
        writes++;
      } else if (key === BOUND_ELEMENTS_KEY) {
        writes += diffBoundElements(ymap, null);
      }
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
  // Keys present on the doc but entirely absent from the element object (the key
  // was dropped, not set to undefined) — clear them too (excluding meta + the
  // element id, which is the map key, not a stored property).
  for (const key of [...ymap.keys()]) {
    if (
      key !== "id" &&
      key !== BOUND_ELEMENTS_KEY &&
      !RECONCILE_META_KEYS.has(key) &&
      !Object.prototype.hasOwnProperty.call(element, key)
    ) {
      ymap.delete(key);
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
