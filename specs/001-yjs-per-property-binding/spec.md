# Feature Specification: Per-Property Yjs Whiteboard Binding

**Feature Branch**: `feat/003-unify-collab-yjs`
**Sub-spec dir**: `specs/001-yjs-per-property-binding/`
**Created**: 2026-06-18
**Status**: Draft (design only — no implementation in this spec)
**Repo**: `alkem-io/excalidraw-fork` (`@alkemio/excalidraw`, Excalidraw 0.18.x)
**Parent epic**: workspace `003-unify-collab-yjs` — Work-Stream **WS-B (B2)**
**DRAFT PR**: alkem-io/excalidraw-fork#30 (this is the binding half of WS-B; B1 upstream-merge is done)

> **Sub-spec — scope guard.** This is the repo-local spec for the *per-property
> Yjs binding* only: the **Excalidraw-scene ↔ `Y.Doc` mapping + awareness
> routing**. The CRDT core (`y-crdt`), the v2 codec, the WebSocket transport,
> the `collaboration-service` server, and the `client-web` wiring are **other
> work-streams** (WS-A/WS-C/WS-D) and are out of scope. The architecture below
> is **frozen at the epic level** (`agents-hq/specs/003-unify-collab-yjs/`):
> id-keyed scene `Y.Map`, per-property element `Y.Map`s, fractional `index`,
> tombstones, awareness-for-ephemeral. This spec details *how*, not *whether*.

## Context

Alkemio's whiteboard collaboration today reconciles concurrent edits at
**whole-element** granularity: the loser of a `version`/`versionNonce` tiebreak
has its *entire* element discarded, silently destroying a concurrent edit to a
*different* property of the same shape (drag vs recolor → one is lost). This
binding replaces that last-write-wins model with a **per-property CRDT merge**:
the whiteboard scene becomes an id-keyed `Y.Map` whose values are per-element
`Y.Map`s, so each element property is an independent CRDT register. Concurrent
edits to different properties of one element both survive; same-property
conflicts resolve deterministically and identically on every client.

The binding is a **new package in the Excalidraw monorepo** that maps the live
Excalidraw scene (`elements`, `files`) to a `Y.Doc`, and routes ephemeral state
(cursors, emoji reactions, countdown timer, idle, visible-bounds) to
**y-protocols awareness** instead of the persisted document. It is
transport-agnostic — it operates on a `Y.Doc` handed to it; how that doc syncs
to a server is WS-D/WS-C.

## Clarifications

### Inherited from the epic (frozen — do not re-litigate)

- Whiteboard scene = **id-keyed top-level `Y.Map`** (element id → a per-element
  `Y.Map` of properties); per-property merge is the headline win (US1, FR-003).
- Element **z-order via the fork's existing fractional `index`** (reuse
  `@excalidraw/fractional-indexing`; do not invent an ordering scheme).
- Deletes via **tombstones** (`isDeleted=true`; element never removed from the doc).
- Ephemeral state (cursor/emoji/countdown/idle/bounds) → **awareness, never the
  persisted scene `Y.Doc`** (FR-008). The scene doc must never carry presence.
- The binding operates on a **`Y.Doc`** and is **transport-agnostic**.
- Wire/runtime CRDT = **canonical JS `yjs` v1 on the wire**; no dependency on the
  Go core or v2 codec (those gate storage/migration in WS-A/WS-E).

### Decisions made in this sub-spec

- **D1 — Property representation tiering.** Scalar props are plain `Y.Map`
  values; ordered geometry that needs sub-merge (`points`) and the `index` are
  represented to survive the v2 ordered-object caveat (data-model §4). Multi-key
  blobs that never need sub-merge (`customData`, `roundness`, bindings) are
  JSON-encoded leaf values, accepting per-key LWW for them.
- **D2 — `points` as a JSON-encoded leaf in v1, with a nested-`Y.Array` option
  flagged as an OPEN question.** See spec OPEN-1.
- **D3 — `appState` is not collaborative by default.** Only elements + files are
  in the scene doc. A minimal shared subset (scene name, view background color)
  is an OPEN question (OPEN-2), not synced in v1.
- **D4 — `version`/`versionNonce` are retained on elements (Excalidraw interop)
  but are NOT the merge authority.** Yjs owns causality; `version` is used only
  as a cheap change signal in the diff. On apply, bump `version`/`versionNonce`
  so Excalidraw's internal invariants and any residual reconcile path stay sane.
- **D5 — One `Y.Doc` per whiteboard; one binding instance per mounted editor.**
  The binding takes `(ydoc, api, awareness?)` and is disposable.

## User Scenarios & Testing

### User Story 1 — Concurrent edits to different properties both survive (Priority: P1)

Two people edit the same shape at once — one drags it (position), the other
recolors it (`strokeColor`). With the binding, both changes persist on every
client because position and color are independent keys on the element's `Y.Map`.

**Why this priority**: This is the entire reason the binding exists — it is the
US1 of the epic, realized at the client. Whole-element LWW loses one of the two
edits today; per-property merge loses neither.

**Independent Test** (no backend): two in-process `Y.Doc`s, each with its own
binding + a stub Excalidraw API. Apply a position change via binding A and a
`strokeColor` change via binding B while "partitioned" (don't exchange updates),
then exchange Yjs updates both ways. Assert both docs' scenes show the new
position *and* the new color on the element, identically.

**Acceptance Scenarios**:

1. **Given** two bindings on one element, **When** A sets `x`/`y` and B sets
   `strokeColor` concurrently, **Then** after sync both elements carry A's
   position and B's color on both docs.
2. **Given** two bindings concurrently set the *same* property to different
   values, **When** they sync, **Then** both converge to one deterministic value
   (Yjs per-key tiebreak), with no divergence and no exception.
3. **Given** one binding deletes an element (tombstone) while the other edits a
   property of it concurrently, **When** they sync, **Then** both docs converge to
   a single consistent outcome (`isDeleted=true` wins as a tombstone; the edit is
   retained on the tombstoned element, which renders as deleted).

---

### User Story 2 — Local edits propagate without echo or loss (Priority: P1)

A user draws, moves, restyles, groups, and deletes shapes. Each local change is
written to the `Y.Doc` exactly once (only the changed keys), and the binding does
**not** re-apply its own writes back onto the scene (no feedback loop), and does
**not** drop the user's in-progress selection/viewport when remote updates arrive.

**Why this priority**: A binding that echoes its own writes or clobbers local
selection on every remote tick is unusable, regardless of merge correctness.

**Independent Test**: one binding + a recording stub API. Make a series of local
edits; assert the resulting Yjs transactions (a) are tagged with the binding's
origin, (b) write only the keys that actually changed, and (c) do not trigger a
re-entrant `updateScene`. Then inject a remote update and assert `updateScene` is
called with `captureUpdate: NEVER` and local `appState` selection is preserved.

**Acceptance Scenarios**:

1. **Given** the binding applies a local change, **When** its own `Y.Doc`
   `observe` fires for that transaction, **Then** the observer short-circuits on
   `transaction.origin === <binding sentinel>` and no `updateScene` runs.
2. **Given** a local change touches only `strokeColor`, **When** the binding
   writes to Yjs, **Then** only the `strokeColor` key is set (not the whole
   element), inside one transaction.
3. **Given** a remote update arrives while the user has elements selected,
   **When** the binding applies it, **Then** the user's `selectedElementIds`,
   zoom, and scroll are preserved.

---

### User Story 3 — Remote edits render correctly, in order, with deletes (Priority: P1)

Edits made by other clients appear locally: new elements show up in the right
z-order, property changes update in place, and deleted elements disappear — all
without the local user losing work or seeing flicker/reordering of untouched
elements.

**Why this priority**: The receive path must faithfully translate per-key Yjs
events back into a correct Excalidraw scene, including fractional-index ordering
and tombstone filtering.

**Independent Test**: two bindings. On binding A: insert three elements, reorder
one (new fractional `index`), delete one (`isDeleted=true`). Sync to B. Assert
B's `getSceneElementsIncludingDeleted()` matches order-by-`index` and the deleted
one is filtered from `getSceneElements()`.

**Acceptance Scenarios**:

1. **Given** a remote insert with fractional `index` between two existing
   elements, **Then** the new element renders in the correct z-position on apply
   (order derived from `index`, ties by id).
2. **Given** a remote `isDeleted=true` on an element, **Then** that element is
   absent from the non-deleted scene but retained as a tombstone in the doc.
3. **Given** two clients concurrently insert elements that pick the *same*
   fractional `index`, **Then** `syncInvalidIndices` repairs the collision
   deterministically and both clients reach identical order.

---

### User Story 4 — Cursors, emoji, and countdown stay out of the persisted scene (Priority: P1)

Live cursors, emoji reactions, the shared countdown timer, idle status, and
visible-scene-bounds are broadcast to other clients but are **never** written to
the scene `Y.Doc`, so they never get persisted, never bloat the snapshot, and
never cause spurious scene diffs.

**Why this priority**: FR-008 — these custom Alkemio features must be preserved
*and* correctly classified as ephemeral. Putting them in the doc would persist
transient state and corrupt the merge/diff model.

**Independent Test**: a binding with a stub awareness. Trigger
`onPointerUpdate`, an emoji reaction, and a countdown event; assert each lands on
the awareness/ephemeral channel and assert the scene `Y.Doc` is byte-unchanged
(no transaction emitted) by any of them.

**Acceptance Scenarios**:

1. **Given** a local pointer move, **Then** the pointer is written to awareness
   local state and the scene doc emits no transaction.
2. **Given** a local emoji reaction / countdown start, **Then** it is sent on the
   ephemeral channel and dispatched to remote peers via
   `dispatchIncomingEmojiReaction` / `dispatchIncomingCountdownTimer`, with the
   scene doc untouched.
3. **Given** a remote awareness update with another user's cursor, **Then** the
   collaborator cursor appears via `updateScene({ collaborators })` without
   altering any element.

---

### User Story 5 — Lossless round-trip with the existing JSON scene (Priority: P2)

An existing Excalidraw-JSON scene (as the legacy whiteboard service persists it)
can be loaded into the `Y.Doc` and read back to an identical scene, so the
one-time migration (WS-E) and initial-load both preserve every element, file,
order, and tombstone.

**Why this priority**: The migration owner (WS-E) needs a deterministic, lossless
`Excalidraw-JSON → Y.Doc → Excalidraw-JSON` transform; the binding owns its
correctness even though it does not run the migration.

**Independent Test**: take a representative scene JSON (mixed element types incl.
linear `points`, image with `fileId`, grouped elements, a soft-deleted element,
`customData`); `populateYDoc(json)`; read back via the binding's export; assert
deep-equal up to the documented normalization rules (see data-model §6).

**Acceptance Scenarios**:

1. **Given** a legacy scene JSON, **When** loaded into a fresh `Y.Doc` and
   exported, **Then** elements, files, order, tombstones, and `customData` match
   the source (modulo `version`/`versionNonce`/`updated` normalization).
2. **Given** a scene with bound text + arrows (`boundElements`, `containerId`,
   `startBinding`/`endBinding`), **Then** the bindings survive the round-trip.

### Edge Cases

- Concurrent **same-property** edit on one element → deterministic Yjs tiebreak,
  no divergence (US1-AC2).
- **Delete-vs-edit** race → tombstone wins; edits retained on the tombstone (US1-AC3).
- Concurrent inserts choosing an **equal fractional index** → `syncInvalidIndices`
  repair (US3-AC3).
- A `points`/`boundElements`/`groupIds` array changed concurrently with another
  property of the same element → array prop is per-key LWW (its representation is
  a single key) while the *other* property merges — documented limitation (OPEN-1).
- **Large** boards (thousands of elements) — diff must be O(changed), not O(scene),
  and apply must update only affected elements (no full `replaceAllElements` churn).
- **Files** referenced by an element that arrives before its `BinaryFileData` —
  image shows `status: "pending"` until the file lands (existing Excalidraw behavior).
- A remote update arriving **mid-local-edit** (element being resized/text-edited)
  — do not yank the element out from under the user (mirror Excalidraw's
  "actively editing" guard from `shouldDiscardRemoteElement`).
- **Awareness churn** (many cursors) must not produce scene transactions.

## Requirements

### Functional Requirements

- **FR-B-001**: The binding MUST represent the whiteboard scene as a top-level
  id-keyed `Y.Map` (`elements`) whose value per id is a `Y.Map` of that element's
  properties — one CRDT register per property (per-property merge).
- **FR-B-002**: The binding MUST translate Excalidraw `onChange(elements, …)`
  into Yjs mutations that write **only the keys that actually changed**, batched
  in a **single `Y.Transaction` tagged with a binding-owned origin sentinel**.
- **FR-B-003**: The binding MUST observe the scene `Y.Doc` and translate Yjs
  events back into a scene update via `updateScene({ elements, captureUpdate:
  NEVER })`, applying **only affected elements** and preserving local `appState`
  (selection, zoom, scroll).
- **FR-B-004**: The binding MUST prevent echo: an observer firing for a
  transaction whose `origin` is the binding's own sentinel MUST be a no-op.
- **FR-B-005**: Element **z-order** MUST be carried by the element's fractional
  `index` key, generated/repaired with the fork's `@excalidraw/fractional-indexing`
  (`generateKeyBetween`, `syncInvalidIndices`); the binding MUST NOT use Y.Array
  position for order.
- **FR-B-006**: Deletes MUST be **tombstones** — set `isDeleted=true` on the
  element `Y.Map`; the binding MUST NOT `Y.Map.delete(elementId)` from the scene
  map for a user delete. Tombstoned elements are filtered from the rendered scene
  but retained in the doc.
- **FR-B-007**: Binary files MUST be stored in a separate top-level `Y.Map`
  (`files`), keyed by `fileId` → `BinaryFileData`, observed shallowly
  (append/remove, not deep). Files MUST NOT live inside element `Y.Map`s.
- **FR-B-008**: Ephemeral state — cursor/pointer, selection highlight, idle,
  collaborator mode, **emoji reactions, countdown timer, visible-scene-bounds** —
  MUST be routed to **y-protocols awareness and/or the ephemeral message type**,
  and MUST NEVER be written to the scene `Y.Doc`.
- **FR-B-009**: Every Excalidraw-persisted element property (the
  `_ExcalidrawElementBase` fields and each subtype's extra fields, incl. `locked`
  and `customData`) MUST be representable as element-`Y.Map` keys per the
  representation tiering in data-model §4. Non-persisted/derived state MUST NOT be.
- **FR-B-010**: The binding MUST provide a **lossless** `Excalidraw-JSON ↔ Y.Doc`
  round-trip (`populateYDoc(json)` and an export) for migration/initial-load, with
  the normalization rules of data-model §6 as the only permitted differences.
- **FR-B-011**: The binding MUST be **transport-agnostic** — constructed from a
  `Y.Doc`, an `ExcalidrawImperativeAPI`, and an optional `awareness`; it MUST NOT
  open sockets, know the server, or depend on the `y-crdt` Go core or v2 codec.
- **FR-B-012**: The binding MUST be **disposable** — a `destroy()` that detaches
  all observers and Excalidraw subscriptions with no leaks, so an editor remount
  is clean.
- **FR-B-013**: The binding MUST mirror Excalidraw's "actively editing" guard:
  a remote update MUST NOT replace an element the local user is mid-editing
  (text edit / resize / new element) until that interaction settles.

### Non-Functional / Constraints

- **NFR-B-001**: The onChange diff MUST be **O(changed elements/properties)**, not
  O(scene); apply MUST touch only affected elements. (Large-board scalability.)
- **NFR-B-002**: The binding depends on **canonical `yjs` + `y-protocols` only**;
  no backend, no Go core, no v2 codec. Wire encoding is **v1**.
- **NFR-B-003**: Unit/component coverage MUST meet the epic's **≥95%** gate
  (FR-015 / SC-008) for the binding package, and contribute the convergence
  scenarios to the shared WS-F e2e harness (SC-009).

## Key Entities

- **WhiteboardBinding**: the object owning the scene↔doc loop. Holds the `Y.Doc`,
  the scene `Y.Map`, the files `Y.Map`, the `ExcalidrawImperativeAPI`, the
  `awareness`, the origin sentinel, and the last-known-elements cache for diffing.
- **Scene map** (`Y.Map<elementId, Y.Map<prop, value>>`): the persisted element
  set. Per-element `Y.Map` = one CRDT register per property.
- **Element map** (`Y.Map<prop, value>`): one element's properties. Includes
  `index` (fractional) and `isDeleted` (tombstone).
- **Files map** (`Y.Map<fileId, BinaryFileData>`): binary image data, separate
  from elements, append/remove.
- **Awareness state**: ephemeral per-participant data (cursor, selection, idle,
  mode) + the ephemeral event channel (emoji, countdown, bounds). Never persisted.
- **Origin sentinel**: a unique object used as the transaction origin so the
  binding can ignore its own writes.

## Success Criteria

- **SC-B-001**: In the two-`Y.Doc` component test, concurrent edits to *different*
  properties of one element lose **0%** of edits (vs measurable loss under
  whole-element LWW). (Realizes epic SC-001.)
- **SC-B-002**: Two bindings reach an **identical** scene after exchanging updates
  for: different-prop merge, same-prop tiebreak, delete-vs-edit, and concurrent
  order — **0 divergent** scenes, with no Go server in the loop.
- **SC-B-003**: Echo test passes — a binding never re-applies its own transaction
  (origin guard), and a local-only `strokeColor` change produces a single
  transaction that writes a single key.
- **SC-B-004**: Awareness isolation test passes — pointer/emoji/countdown produce
  **zero** scene-doc transactions; the scene snapshot is byte-identical before and
  after a burst of ephemeral events.
- **SC-B-005**: Round-trip test passes — a representative legacy scene JSON loaded
  and exported is deep-equal modulo the data-model §6 normalization, for all
  element subtypes incl. `points`, `boundElements`, files, tombstones, `customData`.
- **SC-B-006**: Coverage ≥95% for the binding package (epic SC-008); convergence
  scenarios contributed to the WS-F harness (epic SC-009).

## Open Questions (for antst)

- **OPEN-1 — `points` representation.** v1 plan: store `points` (and
  `pressures`, `boundElements`, `groupIds`) as a **JSON-encoded leaf value**
  (one `Y.Map` key, per-key LWW). This is simple and lossless but means a
  concurrent edit to two *different vertices of the same line* does not merge
  vertex-wise (whole-`points` LWW). Alternative: model `points` as a nested
  `Y.Array<[x,y]>` for true sub-merge — heavier, and freehand `points` churn
  rapidly (every drag appends), risking doc bloat and tombstone growth.
  **Recommendation: ship JSON-leaf in v1** (matches how a `points` edit is almost
  always a single-author gesture); revisit nested `Y.Array` only if multi-author
  single-line vertex merge becomes a real requirement. Needs antst's sign-off.
- **OPEN-2 — `appState` collaboration scope.** v1 plan: **nothing** in the doc;
  `appState` is fully local. Candidate shared subset: scene `name`,
  `viewBackgroundColor` (Excalidraw marks these "observable"). Question: do we
  want background/name to sync (a third top-level `Y.Map appState`), or keep them
  local and let the host set them? **Recommendation: keep local in v1**, leave the
  `appState` map slot reserved in the schema for a later, explicit allow-list.
- **OPEN-3 — `version`/`versionNonce` bump policy on remote apply.** When applying
  a remote per-property change, do we recompute `version`/`versionNonce` locally
  (so Excalidraw's internal version monotonicity holds), or carry the remote
  element's values? Carrying remote risks non-monotonic local `version`; bumping
  locally diverges the nonce across clients (harmless since nonce no longer drives
  merge). **Recommendation: bump locally on apply** (treat version/nonce as
  purely local-render metadata). Confirm this is acceptable given any code still
  reading `getSceneVersion()`.
- **OPEN-4 — tombstone GC.** Tombstones (and `points` churn for freedraw) grow the
  doc unboundedly over a board's life. The epic defers history/GC policy to
  `y-crdt` (FR-025, configurable GC). Question for the binding: do we ever *hard*
  remove very old tombstones at the binding level (risking resurrection on a slow
  peer), or always defer to the server/core GC? **Recommendation: never hard-delete
  at the binding; defer to core GC** — but flag the doc-growth risk for WS-A/WS-C.

## Assumptions & Dependencies

- **Builds on the merged B1 fork** — upstream 0.18.x merged; fractional indexing,
  `isDeleted`, `customData`, and the imperative API are present.
- **Needs neither the v2 codec nor a running backend** — canonical JS `yjs` +
  `y-protocols`; v1 on the wire; transport is WS-D/WS-C.
- **Out of scope**: the WebSocket provider, the `collaboration-service` server,
  the `client-web` swap of socket.io for the binding (WS-D), running the migration
  (WS-E owns it; this spec owns only the round-trip transform's correctness), and
  any change to Excalidraw's feature set beyond the collaboration binding.
- **Frozen architecture**: the id-keyed/per-property/fractional/tombstone/awareness
  shape is fixed by the epic; this spec is the *how*.
