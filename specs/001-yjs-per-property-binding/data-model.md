# Data Model: Per-Property Yjs Whiteboard Binding

The `Y.Doc` schema for an Alkemio whiteboard scene, the property representation
rules, the diff/apply contracts, and the JSON round-trip normalization. This is
the **frozen contract** a later implementation worker executes against.

All names below are **top-level Yjs root types** obtained with `ydoc.getMap(name)`.

---

## 1. Top-level `Y.Doc` shape

```
Y.Doc
├── elements : Y.Map<elementId: string, Y.Map<prop: string, value>>   // the scene
├── files    : Y.Map<fileId: string, BinaryFileData (JSON-leaf)>      // image binaries
└── (reserved) appState : Y.Map<key, value>    // NOT created in v1 — see OPEN-2
```

- **`elements`** — id-keyed scene map. Key = Excalidraw `element.id`. Value = a
  per-element `Y.Map` (one CRDT register per property). This nesting is what
  yields **per-property concurrent merge** (the US1 win).
- **`files`** — separate top-level map; binary file data is large and only ever
  added/removed (never sub-merged), so it lives outside elements and is observed
  shallowly. Keeping it out of element maps keeps element diffs small.
- **`appState`** — **not instantiated in v1.** The slot name is reserved so a
  future, explicit allow-list (scene name / background) can be added without a
  schema migration (OPEN-2). Presence/cursor/selection are awareness, never here.

**Ephemeral state is NOT in the doc.** Cursors, selection highlight, idle, mode,
emoji reactions, countdown timer, and visible-scene-bounds ride **y-protocols
awareness** + the ephemeral message type (see §7). The persisted scene `Y.Doc`
must never carry them (FR-B-008).

---

## 2. Per-element `Y.Map<prop, value>`

Each element id maps to a `Y.Map` whose keys are the element's **persisted**
properties. There is one key per property, so two clients setting two *different*
keys of the same element both land.

Required keys present on every element (from `_ExcalidrawElementBase`):

| key | value form (v1) | merge | notes |
|---|---|---|---|
| `id` | string scalar | LWW (immutable in practice) | mirrors the map key; kept for export symmetry |
| `type` | string scalar | LWW | element subtype; effectively immutable |
| `x`, `y` | number scalar | per-key LWW | position |
| `width`, `height` | number scalar | per-key LWW | size |
| `angle` | number scalar (Radians) | per-key LWW | |
| `strokeColor`, `backgroundColor` | string scalar | per-key LWW | |
| `fillStyle`, `strokeStyle` | string scalar | per-key LWW | enums |
| `strokeWidth`, `roughness`, `opacity` | number scalar | per-key LWW | |
| `roundness` | **JSON-leaf** (`null` \| `{type,value?}`) | per-key LWW | small object, atomic |
| `seed` | number scalar | per-key LWW | |
| `version`, `versionNonce` | number scalar | per-key LWW | **render metadata only**, not merge authority (OPEN-3) |
| `updated` | number scalar | per-key LWW | epoch ms |
| `index` | string scalar (`FractionalIndex`) | per-key LWW + repair | z-order, see §3 |
| `isDeleted` | boolean scalar | per-key LWW, true-wins on apply | tombstone, see §5 |
| `groupIds` | **JSON-leaf** (`string[]`) | per-key LWW | ordered id list |
| `frameId` | string \| null scalar | per-key LWW | |
| `boundElements` | **nested `Y.Map<id, "arrow"\|"text">`** (add/remove set) | concurrent bind/unbind merges (add-wins) | see §4 |
| `link` | string \| null scalar | per-key LWW | |
| `locked` | boolean scalar | per-key LWW | element locking (persisted) |
| `customData` | **JSON-leaf** (`Record<string,any>` \| undefined) | per-key LWW | open-ended Alkemio bag |

Subtype-specific keys (present only on that subtype):

| subtype | extra keys (value form) |
|---|---|
| **text** | `text`, `originalText` (string); `fontSize` (number); `fontFamily` (number/enum); `textAlign`, `verticalAlign` (string); `containerId` (string\|null); `lineHeight` (number); `autoResize` (boolean) |
| **linear/arrow** | `points` (**JSON-leaf** `[x,y][]` — OPEN-1); `startBinding`,`endBinding` (**JSON-leaf** \|null); `startArrowhead`,`endArrowhead` (string\|null); arrow: `elbowed` (boolean); elbow: `fixedSegments` (JSON-leaf), `startIsSpecial`,`endIsSpecial` (boolean\|null) |
| **freedraw** | `points` (**JSON-leaf** — OPEN-1); `pressures` (**JSON-leaf** `number[]`); `simulatePressure` (boolean) |
| **image** | `fileId` (string\|null); `status` (string); `scale` (**JSON-leaf** `[number,number]`); `crop` (**JSON-leaf** \|null) |
| **frame/magicframe** | `name` (string\|null) |
| **iframe/embeddable** | link-driven; `customData?` carries generation data |

> The implementation MUST derive this key set from the live element object
> (`Object.keys`) rather than a hand-maintained whitelist, so new upstream fields
> are carried automatically — *except* the explicitly-excluded derived/runtime
> fields, if any are introduced. The table above is the expected v1 surface.

---

## 3. Fractional `index` (z-order) — reuse the fork's mechanism

- `index` is the element's own `FractionalIndex` branded string, stored as a
  plain scalar key on the element `Y.Map`.
- **Order is derived from `index`, never from Y.Map iteration order** (a `Y.Map`
  has no meaningful order). On apply, sort elements by `index` (ties by `id`) via
  the fork's `orderByFractionalIndex`.
- **Insert between neighbours**: `generateKeyBetween(prevIndex, nextIndex)`.
  Concurrent inserts at the same gap can pick **equal** keys; on apply, run
  `syncInvalidIndices` (fork-native) to deterministically repair collisions so all
  clients converge to identical order (US3-AC3). The repair itself is a local,
  idempotent normalization — it may write corrected `index` values back into the
  doc under the binding's origin (so it is treated as a local change, not echoed).
- This **reuses** `@excalidraw/fractional-indexing@3.3.0` (`packages/fractional-indexing`,
  also surfaced via `packages/element/src/fractionalIndex.ts`). No bespoke order.

---

## 4. The ordered-object / array-property caveat (CRITICAL)

The `y-crdt` v2 codec (and v1 `JSON.stringify`) do **not** byte-canonicalize a
multi-key plain object: two clients setting the *same logical value* of a
JSON-encoded object can emit different bytes, so the CRDT treats them as distinct
conflicting writes (no dedup), and **intra-object concurrent edits cannot merge**
because the whole blob is one opaque register value.

Representation tiering (the single most important rule in this model):

- **Scalars** (`number`, `string`, `boolean`, `null`) → plain `Y.Map` value.
  Safe, mergeable per-key, canonical. *Most* properties are here.
- **`index`** → scalar string, plus the `syncInvalidIndices` repair (§3).
- **JSON-leaf** (atomically-replaced multi-key/array values that do **not** need
  sub-merge) → stored as a single value (object/array directly as the Yjs value).
  Accept **per-key LWW** for the whole blob. Used for: `roundness`, `groupIds`,
  `startBinding`/`endBinding`/`fixedSegments`, `scale`, `crop`, `customData`,
  and `points`/`pressures`.
- **Nested Y type** (`Y.Array`/`Y.Map`) → where genuine sub-merge is required.
  **Used in v1 for `boundElements`** → `Y.Map<boundId, "arrow"|"text">`, an
  add/remove set (add = `set(id,type)`, remove = `delete(id)`) so concurrent
  binding of *different* arrows/text to the **same** node merges instead of
  whole-array LWW-clobbering (OPEN-1 resolved; see §4.1). `points`/`pressures`
  (large, churny, single-author) and `groupIds` (order-sensitive nesting) stay
  JSON-leaf; a nested `Y.Array` for `points` remains a deferred future option.

Rationale: scalars cover the properties where concurrent multi-author edits are
common (position, color, size). The JSON-leaf properties are almost always edited
by a single author in one gesture (drawing a line, grouping, setting customData),
so per-key LWW for them is acceptable and *much* simpler/cheaper than nested Y
types — and it sidesteps the non-canonical-bytes hazard by treating each blob as
one opaque register rather than relying on byte-equality for dedup.

**Consequence to document for users of the binding**: a concurrent edit to two
different *vertices of the same line* (both touching `points`) is per-blob LWW,
not vertex-merged. A concurrent edit to `x` and `strokeColor` of the same element
*is* merged. This asymmetry is intentional and bounded (OPEN-1).

### 4.1 `boundElements` as an add/remove set (OPEN-1 resolved — hybrid)

`boundElements` (the list of arrows/text bound to a bindable element) is the one
array property where concurrent multi-author edits are realistic — two people each
binding a *different* arrow to the same node. Whole-array LWW (today, and the
JSON-leaf option) loses one binding; current Excalidraw `reconcileElements` loses
it too (whole-element LWW). So it is modelled as a **nested `Y.Map`**:

- Key = bound element `id`; value = `"arrow" | "text"`. Order is **not**
  semantically meaningful (the fork consumes `boundElements` via `arrayToMap` /
  `.find(x=>x.id)` / `.filter`), so a map is a faithful, lossless representation.
- **onChange → Y.Map**: diff the element's `boundElements` array against the
  `Y.Map`; `set(id,type)` for added ids, `delete(id)` for removed ids (under the
  binding's origin). **apply (Y.Map → scene)**: materialize back into a
  `BoundElement[]` array on the element.
- **Add-wins** under concurrency: two different bindings to one node → two keys →
  both survive. Same id bound twice → same key, idempotent.
- **Invariant edge — "at most one bound text"**: concurrent binding of two
  *different* text elements yields two `type:"text"` keys. Resolve
  deterministically **on apply** (keep the lowest `id`, drop extra text bindings)
  — a rare, self-healing conflict, not a divergence.

This is the only nested Y type in v1; every other multi-key property stays
JSON-leaf per §4.

---

## 5. Tombstones (deletes)

- A user delete sets `isDeleted=true` on the element `Y.Map`. The element is
  **never** removed from the scene `Y.Map` by the binding for a user delete
  (FR-B-006).
- On apply, the binding passes the full set (incl. tombstones) to the scene model
  but renders via `getNonDeletedElements`; deleted elements stay in the doc as
  tombstones so a concurrent edit-vs-delete converges (the tombstone is the
  authoritative "deleted" register; concurrent property edits remain on it but it
  renders as gone — US1-AC3).
- **Delete-vs-edit resolution**: `isDeleted=true` is treated as winning on apply
  (an element that is `true` on *any* converged replica is deleted). Same-key LWW
  between `true`/`false` resolves by Yjs tiebreak, but the binding's apply rule
  biases render toward "deleted if true anywhere it has converged" by simply
  honoring the merged `isDeleted` value — which, once `true` has been written and
  synced, stays `true` unless explicitly un-deleted (restore). Restore is an
  explicit `isDeleted=false` write.
- Hard removal of an element from the scene `Y.Map` is reserved for **GC**
  (server/core level, OPEN-4), never a user action at the binding.

---

## 6. JSON ↔ Y.Doc round-trip & normalization (migration / initial load)

`populateYDoc(sceneJSON, ydoc)` and `exportSceneJSON(ydoc)` are the migration/
initial-load transform (FR-B-010). The round-trip is **lossless** modulo:

**Normalization rules** (the only permitted differences):

1. `version` / `versionNonce` / `updated` MAY be regenerated on load/apply (they
   are render metadata, not merge authority — OPEN-3); a round-trip MUST preserve
   them if no edit occurs, but the migration MAY normalize them.
2. JSON-leaf values are compared by **deep value equality**, not byte equality
   (the non-canonical-bytes caveat means byte form is not stable).
3. Element **order** is compared by `orderByFractionalIndex` output, not by source
   array position — a source scene with missing/invalid `index` values is repaired
   by `syncInvalidIndices` on load (this is an *intended* normalization, and the
   only case where order may legitimately change vs a malformed source).
4. `files` map = the source `files` record verbatim (deep-equal).
5. Tombstones (`isDeleted=true` elements) are carried through unchanged.

**Losslessness criteria** (what MUST be identical):

- Every non-deleted and deleted element present, by id.
- Every scalar property value identical.
- Every JSON-leaf property deep-equal.
- `boundElements`/`containerId`/`startBinding`/`endBinding` bindings intact
  (so bound text + arrows survive — US5-AC2).
- `files` deep-equal.
- Rendered order (by `index`) identical to the source's rendered order (modulo
  rule 3 for malformed sources).

The migration (WS-E) consumes `populateYDoc`; this spec owns its correctness, not
its scheduling.

---

## 7. Awareness / ephemeral channel (NOT in the doc)

Routed via the `awareness` instance (y-protocols) and the WS `2` Ephemeral
message type (epic `contracts/ws-protocol.md`), never the scene doc:

| ephemeral | mechanism | source in fork |
|---|---|---|
| cursor / pointer | `awareness.setLocalStateField("pointer", …)` + `"button"` | `onPointerUpdate` |
| selection highlight | `awareness.setLocalStateField("selectedElementIds", …)` | local appState |
| user identity / color / avatar | `awareness` `user` field | host-provided |
| idle status | awareness field / ephemeral `IDLE_STATUS` | pointer/visibility timers |
| collaborator mode (viewer/collaborator, inactivity downgrade) | control message (S→C) | server-driven |
| **emoji reaction** | ephemeral `EMOJI_REACTION` → `dispatchIncomingEmojiReaction` | `onRequestBroadcastEmojiReaction` |
| **countdown timer** | ephemeral `COUNTDOWN_TIMER` → `dispatchIncomingCountdownTimer` | `onRequestBroadcastCountdownTimer` |
| **visible scene bounds** | ephemeral `USER_VISIBLE_SCENE_BOUNDS` | follow-mode |

Remote awareness changes update collaborator cursors via
`api.updateScene({ collaborators })` — which touches **no elements**. The
ephemeral set matches the legacy service's `WS_SUBTYPES` exactly, so parity is
direct (research §3).

---

## 8. Diff (onChange → Y) and apply (observe → scene) contracts

### Diff (`onChange` → Yjs)

1. Cheap gate: compare the new `elements` to `lastKnownElements` by `(id, version)`
   pairs; if equal, do nothing (mirrors y-excalidraw's `areElementsSame`).
2. For changed/added/removed elements, compute per-element, **per-property**
   deltas: for an existing element, only the keys whose value changed
   (deep-compare JSON-leaf, `===` for scalars); for a new element, all keys + a
   `generateKeyBetween` `index`; for a removed-from-array element that should be
   deleted, set `isDeleted=true`.
3. Apply all writes in **one** `ydoc.transact(fn, ORIGIN)` (the binding's origin
   sentinel). Update `lastKnownElements`.
4. Files: diff `files` by id; append new `BinaryFileData`, (rarely) remove; same
   origin-tagged transaction or a sibling one.

### Apply (Yjs observe → scene)

1. Observe the scene map (`observeDeep` to catch per-element key changes) and the
   files map (`observe`, shallow).
2. On an event whose `transaction.origin === ORIGIN` → **return** (echo guard).
3. Collect changed element ids; rebuild those elements from their `Y.Map`s;
   reuse unchanged local elements as-is (don't rebuild the whole scene).
4. Order by `index` (`orderByFractionalIndex`); run `syncInvalidIndices` for
   collision repair.
5. Respect the "actively editing" guard (FR-B-013): skip replacing an element the
   local user is mid-editing.
6. `api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })`;
   preserve `appState` selection/zoom/scroll. Update `lastKnownElements`.

---

## 9. Binding lifecycle

- **Construct** `new WhiteboardBinding(ydoc, api, awareness?)`: resolve roots,
  seed `lastKnownElements` from the doc, attach observers + `api.onChange`.
- **Initial load**: if the doc is empty and an initial scene JSON is provided,
  `populateYDoc` first; otherwise the doc's current state is authoritative and the
  scene is initialized from it.
- **`destroy()`**: detach every observer and the `onChange`/awareness
  subscription; null out caches. No leaks across editor remounts (FR-B-012).
