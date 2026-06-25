import * as Y from "yjs";

import { LOCAL_ORIGIN } from "./origin";

import type { BoundElement } from "../types";

/**
 * Per-property element↔`Y.Map` schema — the core's CRDT representation of the
 * element store (native-Yjs core, M1).
 *
 * Each Excalidraw element is a nested `Y.Map<prop, value>` inside the top-level
 * `yElements: Y.Map<id, Y.Map<prop, value>>`, so concurrent edits to *different*
 * properties of the same element both survive (per-property LWW, not whole-object
 * replace). This file owns the element↔`Y.Map` mapping in both directions plus the
 * per-property diff write path.
 *
 * Historically this lived in `packages/yjs-binding/src/schema.ts`; it has moved
 * into `packages/element` because the doc is now the element store. The
 * yjs-binding package re-exports it for now (deleted at M3).
 */

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
 * `versionNonce`/`updated`, write them back under `LOCAL_ORIGIN`, broadcast,
 * and every peer would re-mint them — an unbounded cross-replica ping-pong.
 *
 * They are excluded from every write path (`elementToYMap`, `writeChangedKeys`),
 * ignored as change signals, and re-derived on apply from local doc state —
 * deterministically, so re-applying the same doc state is idempotent (no
 * `Math.random()`/`Date.now()`).
 *
 * NOTE (M1): single-user, no provider attached. The local `version`/`versionNonce`
 * on the in-memory element are still maintained by `mutateElement` so the editor's
 * own change-detection/reconciliation keeps working; they are simply not *stored*
 * in the doc (each peer re-derives them on read — see `yMapToElement`).
 */
export const RECONCILE_META_KEYS: ReadonlySet<string> = new Set([
  "version",
  "versionNonce",
  "updated",
]);

export type BoundElementType = BoundElement["type"];

/** A plain element record as it travels through the schema (mutable copy). */
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
      // ALWAYS a nested `Y.Map` (even for `null`/`[]`), so the set has stable
      // identity for per-property CRDT merge (concurrent binds to the same node
      // both survive). The `null` vs `[]` editor distinction is preserved
      // locally by `Scene` (it is local view state, not CRDT state) — see
      // `Scene`'s `meta` table.
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
 *
 * The doc does NOT store `version`/`versionNonce`/`updated` (`RECONCILE_META_KEYS`,
 * OPEN-3). Callers that need the editor's reconciliation metadata on the derived
 * element (the live `Scene` does) re-attach it locally — see `Scene`'s recompute,
 * which carries the previous in-memory `version`/`versionNonce`/`updated` forward.
 */
export const yMapToElement = (ymap: Y.Map<unknown>): ElementRecord => {
  const element: ElementRecord = {};
  for (const [key, value] of ymap.entries()) {
    if (key === BOUND_ELEMENTS_KEY) {
      // Empty nested map → `null` here (the CRDT cannot distinguish `null` from
      // `[]`); `Scene` restores `[]` for elements whose source was `[]` from its
      // local `meta` table. The binding's apply path also reads `null` for empty.
      element[key] = yMapToBoundElements(value as Y.Map<BoundElementType>);
    } else if (JSON_LEAF_KEYS.has(key)) {
      element[key] = cloneJSON(value);
    } else {
      element[key] = value;
    }
  }
  // Enforce the universal Excalidraw element invariant `groupIds: []` at the
  // materialization boundary. The doc only carries keys that were present when the
  // element was written, and `elementToYMap` skips `undefined` values — so an
  // element authored by an earlier schema (or with `groupIds` omitted) comes back
  // WITHOUT the key. Upstream guarantees `groupIds` is always an array and
  // `renderStaticScene` reads `element.groupIds.length`/`.forEach` unguarded, so a
  // missing value throws and the React error boundary unmounts the whole editor.
  // Default it here so the native store always yields renderable elements (this is
  // the documented element contract, not a renderer band-aid).
  if (!Array.isArray(element.groupIds)) {
    element.groupIds = [];
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
 * MUST be called inside a `ydoc.transact(fn, LOCAL_ORIGIN)`. Returns the number
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
      !RECONCILE_META_KEYS.has(key) &&
      !Object.prototype.hasOwnProperty.call(element, key)
    ) {
      if (key === BOUND_ELEMENTS_KEY) {
        // boundElements is a nested Y.Map, not a plain scalar: empty it via
        // diffBoundElements (deleting the parent key would drop the nested map
        // and break the next diff). Symmetric with the `next === undefined`
        // branch above — a dropped property must clear bindings just like an
        // explicit `undefined`, else stale bindings resurrect on materialization.
        writes += diffBoundElements(ymap, null);
      } else {
        ymap.delete(key);
        writes++;
      }
    }
  }
  return writes;
};

/**
 * Diff the element's `boundElements` array against the nested `Y.Map`, applying
 * `set`/`delete` for the delta only (§4.1). MUST run inside a
 * `LOCAL_ORIGIN` transaction. Returns the number of mutations applied.
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

// ---------------------------------------------------------------------------
// files schema (native-Yjs core, M4 — persistence cutover)
//
// `yFiles: Y.Map<fileId, BinaryFileData>` (`doc.getMap(FILES)`) — the scene's
// image binaries live IN the doc, alongside `yElements`, so the encoded doc
// (`encodeStateAsUpdateV2`) carries the WHOLE whiteboard: a persisted doc the
// editor saves is exactly what the server / collab-service stores
// (`getMap("elements")` + `getMap("files")` + `getMap("appState")`). Data-model
// §1: a `BinaryFileData` is a flat JSON record (`{mimeType,id,dataURL,created,
// lastRetrieved?,version?}`), stored whole as a **JSON-leaf** value — it is only
// ever added/removed, never sub-merged, so there is no per-property nesting.
// ---------------------------------------------------------------------------

/** A binary-file record as it travels through the schema (a flat JSON object —
 * structurally Excalidraw's `BinaryFileData`, kept loose here so the element
 * package does not depend on `packages/excalidraw`'s types). Keyed by `id`. */
export type FileRecord = { id: string } & Record<string, unknown>;

/**
 * Diff a full `files` map into `yFiles` (the doc's `Y.Map<fileId,
 * BinaryFileData>`): add/replace any file whose JSON value changed, and — when
 * `prune` is set — remove files absent from `next`. Each file value is stored
 * whole (deep-cloned JSON-leaf), so it round-trips byte-stable through the doc.
 *
 * Files are append-mostly in Excalidraw (a deleted image's binary is normally
 * left in place), so `prune` defaults to `false`: a normal save MERGES files in
 * rather than dropping any a peer may have just added. MUST run inside a
 * `doc.transact`. Returns the number of `Y.Map` mutations applied.
 */
export const writeFiles = (
  yFiles: Y.Map<unknown>,
  next: Readonly<Record<string, FileRecord>>,
  options?: { prune?: boolean },
): number => {
  let mutations = 0;
  if (options?.prune) {
    const keep = new Set(Object.keys(next));
    for (const id of [...yFiles.keys()]) {
      if (!keep.has(id)) {
        yFiles.delete(id);
        mutations++;
      }
    }
  }
  for (const [id, file] of Object.entries(next)) {
    if (file === undefined || file === null) {
      continue;
    }
    if (!deepEqual(yFiles.get(id), file)) {
      yFiles.set(id, cloneJSON(file));
      mutations++;
    }
  }
  return mutations;
};

/**
 * Materialize the doc's `yFiles` back into a plain `Record<fileId,
 * BinaryFileData>` (deep-cloned, so the result never aliases doc-internal data)
 * — the inverse of {@link writeFiles}.
 */
export const readFiles = (
  yFiles: Y.Map<unknown>,
): Record<string, FileRecord> => {
  const out: Record<string, FileRecord> = {};
  for (const [id, value] of yFiles.entries()) {
    out[id] = cloneJSON(value) as FileRecord;
  }
  return out;
};

// ---------------------------------------------------------------------------
// appState schema (native-Yjs core, M4 — persistence cutover)
//
// `yAppState: Y.Map<key, value>` (`doc.getMap(APPSTATE)`) holds ONLY the
// persistable / collaborative subset of appState — the `APPSTATE_ALLOW_LIST`
// (scene background + name). Everything else in Excalidraw's appState is
// local-only (selection, zoom, scroll, active tool, …) and is NEVER written to
// the doc (data-model §1, FR-B-008): it must not persist and must not
// collaborate. Each allow-listed key is a plain LWW scalar.
// ---------------------------------------------------------------------------

/**
 * Write the persistable appState subset into `yAppState`. Only the
 * `APPSTATE_ALLOW_LIST` keys are considered; a key whose value is `undefined`
 * (or simply absent) is left untouched (we never clobber a stored background
 * with a partial update that omits it). MUST run inside a `doc.transact`.
 * Returns the number of `Y.Map` mutations applied.
 */
export const writeAppState = (
  yAppState: Y.Map<unknown>,
  appState: Readonly<Partial<Record<AppStateAllowKey, unknown>>>,
): number => {
  let mutations = 0;
  for (const key of APPSTATE_ALLOW_LIST) {
    const next = appState[key];
    if (next === undefined) {
      continue;
    }
    if (yAppState.get(key) !== next) {
      yAppState.set(key, next);
      mutations++;
    }
  }
  return mutations;
};

/**
 * Read the persistable appState subset (the `APPSTATE_ALLOW_LIST` keys present)
 * out of `yAppState` — the inverse of {@link writeAppState}. Returns only the
 * keys actually stored, so a caller can merge them over its defaults.
 */
export const readAppState = (
  yAppState: Y.Map<unknown>,
): Partial<Record<AppStateAllowKey, unknown>> => {
  const out: Partial<Record<AppStateAllowKey, unknown>> = {};
  for (const key of APPSTATE_ALLOW_LIST) {
    if (yAppState.has(key)) {
      out[key] = yAppState.get(key);
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// whole-whiteboard doc ↔ bytes persistence (native-Yjs core, M4)
//
// The persistence unit is the WHOLE `Y.Doc` — elements + files + appState in the
// ONE doc — encoded as Yjs **V2** bytes (`encodeStateAsUpdateV2`). This is the
// exact format the Alkemio server / collab-service stores (a base64 V2 snapshot
// over `getMap("elements")` / `getMap("files")` / `getMap("appState")`), so a
// doc the editor persists IS what the backend stores, and vice-versa. These two
// helpers are the editor-side persistence LAYER: build a portable doc from a
// scene's content and encode it, or decode stored bytes back into a doc the
// `Scene` constructor adopts (`new Scene(null, { doc })`). They deliberately do
// NOT touch the network — the live backend transport is follow-on wiring.
// ---------------------------------------------------------------------------

/** The portable content of one whiteboard: everything that persists. */
export type WhiteboardSnapshot = {
  elements: readonly Record<string, unknown>[];
  files: Readonly<Record<string, FileRecord>>;
  appState: Readonly<Partial<Record<AppStateAllowKey, unknown>>>;
};

/**
 * Build a fresh `Y.Doc` populated with `elements` + `files` + `appState` under
 * the canonical root-map names. The doc is a portable, self-contained snapshot;
 * the caller typically `encodeStateAsUpdateV2`s it (see {@link encodeSnapshot}).
 * Writes happen under `LOCAL_ORIGIN` for consistency, though a one-shot
 * population has no observers attached.
 */
export const buildSnapshotDoc = (snapshot: WhiteboardSnapshot): Y.Doc => {
  const doc = new Y.Doc();
  const yElements = doc.getMap<Y.Map<unknown>>(ELEMENTS);
  const yFiles = doc.getMap<unknown>(FILES);
  const yAppState = doc.getMap<unknown>(APPSTATE);
  doc.transact(() => {
    for (const element of snapshot.elements) {
      const id = element.id as string;
      yElements.set(id, elementToYMap(element as ElementRecord));
    }
    writeFiles(yFiles, snapshot.files, { prune: false });
    writeAppState(yAppState, snapshot.appState);
  }, LOCAL_ORIGIN);
  return doc;
};

/**
 * Encode a whiteboard snapshot to Yjs **V2** bytes — the editor's native
 * persistence wire/storage form, matching the server's stored doc format.
 */
export const encodeSnapshot = (snapshot: WhiteboardSnapshot): Uint8Array => {
  const doc = buildSnapshotDoc(snapshot);
  const bytes = Y.encodeStateAsUpdateV2(doc);
  doc.destroy();
  return bytes;
};

/**
 * Decode stored Yjs **V2** bytes back into a whiteboard snapshot
 * (`elements` ordered by fractional index, `files`, persistable `appState`) —
 * the inverse of {@link encodeSnapshot}. The decoded `elements` carry no
 * reconciliation metadata (the doc never stores it); a live `Scene` re-derives
 * it on adoption. `version`/`versionNonce`/`updated` are seeded here so the
 * snapshot is a valid standalone element set (the app's `restoreElements`
 * normalizes them anyway).
 */
export const decodeSnapshot = (bytes: Uint8Array): WhiteboardSnapshot => {
  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, bytes);
  const yElements = doc.getMap<Y.Map<unknown>>(ELEMENTS);
  const yFiles = doc.getMap<unknown>(FILES);
  const yAppState = doc.getMap<unknown>(APPSTATE);

  const elements: Record<string, unknown>[] = [];
  for (const [id, ymap] of yElements.entries()) {
    const record = yMapToElement(ymap);
    record.id = id;
    elements.push(record);
  }
  elements.sort((a, b) => {
    const ai = a.index as string;
    const bi = b.index as string;
    if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
    return (a.id as string) < (b.id as string) ? -1 : 1;
  });

  const files = readFiles(yFiles);
  const appState = readAppState(yAppState);
  doc.destroy();
  return { elements, files, appState };
};

// NB: do NOT re-export LOCAL_ORIGIN here. It is declared in ./origin and the
// `yjs` barrel (index.ts) already re-exports it via `export * from "./origin"`.
// Re-exporting the same name from this module too made it an ambiguous star
// export in the barrel (`export *` from both ./origin and ./schema), which
// silently drops `LOCAL_ORIGIN` from `@alkemio/excalidraw`'s `yjs` entrypoint.
// `schema.ts` still imports it (line ~3) for its own internal use.
