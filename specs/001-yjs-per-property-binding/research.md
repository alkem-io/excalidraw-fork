# Research: Per-Property Yjs Whiteboard Binding

**Date**: 2026-06-18
**Repo**: `alkem-io/excalidraw-fork` (Excalidraw monorepo, 0.18.x line, `@alkemio/excalidraw`)
**Epic**: workspace `003-unify-collab-yjs` — WS-B (B2)
**References**: merged fork source (this repo), `whiteboard-collaboration-service`, `client-web`,
the OSS `y-excalidraw` binding (RahulBadenkal/y-excalidraw), and the `y-crdt` fork's
v2-codec spec (`y-crdt/specs/001-v2-encoding-and-sync-protocol/`).

This document grounds the binding design in the *actual* code of the merged fork and the
system it replaces. Every claim below is traceable to a file path or an external source.

---

## 1. The Excalidraw scene + change API (this fork)

### `onChange` and the imperative API

`packages/excalidraw/types.ts` — `ExcalidrawProps.onChange`:

```ts
onChange?: (
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
) => void;
```

It fires through the React render cycle after the scene store applies a mutation
(`App.tsx` `updateScene` → `scene.replaceAllElements` → store microaction subscription). The
`elements` argument is **ordered and includes deleted** elements (soft-delete model).

`ExcalidrawImperativeAPI` (`packages/excalidraw/types.ts`) — the surface the binding drives:

- `updateScene({ elements?, appState?, collaborators?, captureUpdate? })` — apply remote state.
- `getSceneElements()` — **non-deleted** elements only.
- `getSceneElementsIncludingDeleted()` / `getSceneElementsMapIncludingDeleted()` — full set incl. tombstones.
- `getAppState()`, `getFiles()`, `addFiles(BinaryFileData[])`.
- `onChange(cb)` — subscription form (equivalent to the prop).
- Fork-only: `dispatchIncomingEmojiReaction(...)`, `dispatchIncomingCountdownTimer(...)`.

`captureUpdate: CaptureUpdateAction.NEVER` is the documented way to apply a remote update
**without** pushing it onto the local undo stack — load-bearing for the observe→scene path.

### Scene-version helpers

`packages/element/src/index.ts`: `getSceneVersion()` (sum of `element.version`, deprecated) and
`hashElementsVersion()` (djb2 over `versionNonce`). Useful only as a cheap "did anything
change" signal; **not** used for CRDT semantics here.

### `client-web` mount site

`client-web/src/domain/common/whiteboard/excalidraw/CollaborativeExcalidrawWrapper.tsx`
mounts `<Excalidraw>` with: `excalidrawAPI={handleInitializeApi}`, `initialData`, `onChange`,
`onPointerUpdate={collabApi?.onPointerUpdate}`, `onRequestBroadcastEmojiReaction`,
`onRequestBroadcastCountdownTimer`, `viewModeEnabled={isReadOnly}`, `isCollaborating`,
`generateIdForFile`. (Note: the `excalidrawAPI`→`onExcalidrawAPI` prop rename from the
upstream merge is sequenced with the WS-D pin bump — see WS-B1 tasks.) This is the seam where
WS-D will swap the socket.io `Collab`/`Portal` client for the Yjs binding.

---

## 2. Element shape, ordering, deletes, reconciliation

### Element type (`packages/element/src/types.ts`)

`_ExcalidrawElementBase` (the shape every element shares) carries, among others:

```
id, x, y, width, height, angle (Radians), strokeColor, backgroundColor,
fillStyle, strokeWidth, strokeStyle, roundness, roughness, opacity, seed,
version, versionNonce, index (FractionalIndex|null), isDeleted,
groupIds (readonly GroupId[]), frameId (string|null),
boundElements (readonly {id,type:"arrow"|"text"}[] | null),
updated, link (string|null), locked, customData?
```

Subtypes add fields:

| Subtype | Notable extra fields |
|---|---|
| Text | `text`, `originalText`, `fontSize`, `fontFamily`, `textAlign`, `verticalAlign`, `containerId`, `lineHeight`, `autoResize` |
| Linear / Arrow | `points: readonly LocalPoint[]`, `startBinding`, `endBinding`, `startArrowhead`, `endArrowhead`; Arrow adds `elbowed`; Elbow adds `fixedSegments`, `startIsSpecial`, `endIsSpecial` |
| FreeDraw | `points: readonly LocalPoint[]`, `pressures: readonly number[]`, `simulatePressure` |
| Image | `fileId`, `status`, `scale: [number,number]`, `crop` |
| Frame / MagicFrame | `name: string\|null` |
| Iframe / Embeddable | `customData?`, link-driven |

**`points` is an ordered array of `[number,number]` tuples** (the polyline geometry).
**`boundElements` and `groupIds` are arrays of small records / ids.** These three are the
"hard" shapes for CRDT representation (see data-model §4).

### Fractional index (z-order) — REUSE, do not invent

`packages/element/src/fractionalIndex.ts`, backed by the vendored
`@excalidraw/fractional-indexing@3.3.0` (`packages/fractional-indexing`).

- `index: FractionalIndex` is a **branded string** (`string & { _brand: "franctionalIndex" }`).
- Order-preserving base-62 keys; `generateKeyBetween(a, b)` and `generateNKeysBetween(a, b, n)`
  produce keys strictly between two bounds.
- `orderByFractionalIndex(elements)` sorts by `index`, ties broken by element `id`.
- `syncMovedIndices(elements, moved)` (optimistic local moves) and `syncInvalidIndices(elements)`
  / `syncInvalidIndicesImmutable(elements)` (repair after reconcile/undo) keep `index`
  consistent with array order.
- `validateFractionalIndices(...)` enforces the invariants.

**Conclusion**: the fork already has a complete, conflict-free fractional ordering scheme.
The binding stores `index` as a per-element `Y.Map` key and lets concurrent inserts pick
keys between neighbours — no array-move conflict, no bespoke ordering. On apply, run
`syncInvalidIndices` to repair the rare concurrent-equal-key collision deterministically.

### Soft-delete (`isDeleted`) — tombstones already exist

Elements are **never removed** from the array; `isDeleted: true` marks them. `getNonDeletedElements`
(`packages/element/src/index.ts`) filters for render; `Scene` keeps dual caches
(all vs non-deleted). This *is* the tombstone mechanism — the binding represents a delete as
setting `isDeleted=true` on the element's `Y.Map`, never as a `Y.Map.delete(id)`.

### Whole-element LWW we are replacing (`packages/excalidraw/data/reconcile.ts`)

`shouldDiscardRemoteElement(localAppState, local, remote)` keeps local (discards remote) when:

```
local is being actively edited (editingTextElement/resizingElement/newElement)
|| local.version > remote.version
|| (local.version === remote.version && local.versionNonce <= remote.versionNonce)
```

i.e. **higher `version` wins; tie → lower `versionNonce` wins.** This is *whole-element* —
the loser's entire element (all properties) is discarded. **This is exactly the granularity
the per-property Y.Map binding removes:** with CRDT merge, concurrent edits to *different*
properties of one element both survive, and same-property conflicts resolve by Yjs's
deterministic per-key tiebreak rather than by `versionNonce`.

### Custom Alkemio element props

No element *subtype* was modified to add Alkemio-specific persisted fields. The fork's custom
features (countdown timer, emoji reactions) are wired as **imperative-API events**
(`onRequestBroadcastEmojiReaction`, `onRequestBroadcastCountdownTimer`,
`dispatchIncomingEmojiReaction`, `dispatchIncomingCountdownTimer`) and a `"emojiReaction"`
`ToolType` — **ephemeral**, never element data. Element locking uses the stock `locked: boolean`
field (persisted). `customData?: Record<string, any>` is the only open-ended per-element bag and
must be carried as a scene key (JSON-encoded value — see the ordered-object caveat below).

**Implication for the spec**: the binding must enumerate scene-persisted props as `Y.Map` keys
(including `locked`, `customData`) and route countdown/emoji to awareness, *not* the doc.

---

## 3. What we are replacing — current Alkemio whiteboard collaboration

### Server: `whiteboard-collaboration-service`

- **Transport**: socket.io (`src/excalidraw-backend/server.ts`).
- **Reconciliation**: server-side whole-element LWW
  (`src/excalidraw-backend/utils/reconcile.ts` `shouldDiscardRemoteElement` — same
  version/versionNonce rule as the client), applied in
  `src/excalidraw-backend/types/in.memory.snapshot.ts` `reconcile()`, which bumps a room
  version counter.
- **Events** (`src/excalidraw-backend/types/event.names.ts`): `INIT_ROOM`, `JOIN_ROOM`,
  `SERVER_BROADCAST` (reliable, ArrayBuffer), `SERVER_VOLATILE_BROADCAST` (lossy),
  `CLIENT_BROADCAST`, `IDLE_STATE`, `COLLABORATOR_MODE`, `ROOM_USER_CHANGE`,
  `ROOM_SAVED`/`ROOM_NOT_SAVED`, `SCENE_INIT`, `PING`.
- **Payload subtypes** (`WS_SUBTYPES`): `SCENE_UPDATE`, `MOUSE_LOCATION`, `IDLE_STATUS`,
  `EMOJI_REACTION`, `COUNTDOWN_TIMER`, `USER_VISIBLE_SCENE_BOUNDS`. Note that the new WS
  contract (`agents-hq/.../contracts/ws-protocol.md`) carries this **same ephemeral subtype
  set** over the `2` Ephemeral message type — parity is direct.
- **Persistence**: throttled (default ~1s) full-scene save: `UtilService.save()` →
  `WhiteboardIntegrationService.save()` → RabbitMQ to `server`. Content = full Excalidraw JSON
  (elements + files), stringified.
- **Access control**: per-room max-collaborators, read-only/collaborator mode, inactivity
  downgrade (~5 min) via `COLLABORATOR_MODE`.

### Client: `client-web`

- `domain/common/whiteboard/excalidraw/collab/{Collab.ts,Portal.ts,useCollab.ts}`.
- `Portal` is a socket.io client. Local `onChange` → `syncScene` → `broadcastScene`
  (changed elements + new files; full resync every 10s). Remote `client-broadcast`
  → `reconcileElementsAndLoadFiles` → `updateScene({ captureUpdate: NEVER })`.
- Ephemerals: `onPointerUpdate` → `broadcastMouseLocation` (volatile);
  `broadcastEmojiReaction`; `broadcastCountdownTimer`; idle via pointer/visibility events.

**Parity target for the binding + WS-D**: every behavior above must be preserved, but the
SCENE_UPDATE reliable channel is replaced by **y-protocols sync over the Y.Doc**, and the
volatile channel by **y-protocols awareness + the `2` ephemeral type**. The binding owns only
the scene↔Y.Doc mapping and the awareness routing; the socket/transport swap is WS-D/WS-C.

---

## 4. Reference binding `y-excalidraw` — adopt vs change

Source read from GitHub `RahulBadenkal/y-excalidraw` (`src/index.ts`, `src/diff.ts`,
`src/helpers.ts`). It is **not** present on disk; the fork bundles no `yjs`/`y-excalidraw`
today (the binding package adds them).

| Aspect | y-excalidraw | This spec | Decision |
|---|---|---|---|
| Scene structure | `Y.Array<Y.Map>` where each map = `{ el: <whole element>, pos: <frac index> }` | id-keyed `Y.Map<elementId, Y.Map<prop,value>>` | **CHANGE** |
| Merge granularity | **per-element** (the whole `el` value is replaced on any change) | **per-property** (each prop is its own `Y.Map` key) | **CHANGE — this is the headline win (US1)** |
| onChange→Y | cached snapshot + delta ops, wrapped in `transact(ops, origin=this)` | same diff+transaction pattern, but emit **per-property** key writes | **ADOPT (pattern), adapt to per-prop** |
| Y→scene | `observeDeep` + `txn.origin===this` guard; rebuild full element list; one `updateScene` | same guard + observe; rebuild affected elements; `updateScene({captureUpdate:NEVER})` | **ADOPT (pattern)** |
| Echo prevention | `if (txn.origin === this) return` (identity sentinel) | identical sentinel origin object | **ADOPT exactly** |
| Z-order | fractional index in a separate `pos` field | fractional index as the element's own `index` key (reuse fork's `@excalidraw/fractional-indexing`) | **ADOPT, but use native `index`** |
| Files | separate append-only `Y.Map<fileId, BinaryFileData>`, shallow `observe` | identical: separate top-level `files` `Y.Map` | **ADOPT** |
| Awareness | y-protocols awareness for pointer/selection/user | y-protocols awareness for cursor/selection/idle/mode + the `2` ephemeral type for emoji/countdown/bounds | **ADOPT + extend** |
| version/versionNonce | used only as a cheap "changed?" signal, not for reconciliation | same — `version` is a change signal; Yjs owns causality; `versionNonce` becomes irrelevant to merge | **ADOPT (pattern)** |

**Net**: we adopt y-excalidraw's *control flow* (diff → origin-tagged transaction → observe →
guarded apply, fractional order, separate files map, awareness) and **change its data model**
from per-element to per-property. The per-property change is the entire reason for the rework
and cannot be obtained by configuring y-excalidraw — it is structural.

---

## 5. The v2-codec ordered-object caveat (from the `y-crdt` fork)

The `y-crdt` v2 update codec encodes arbitrary JS values via lib0 "any" encoding
(`WriteAny`), and v1 via `JSON.stringify`. **Neither guarantees a canonical byte form for a
multi-key plain object**: key order and encoding of a `{a,b,c}` blob depend on the producer,
so two clients that independently set the *same logical value* of a JSON-encoded multi-key
property can produce **different bytes** → the CRDT sees two distinct conflicting writes (no
dedup, last-writer-by-tiebreak), and *intra-object* concurrent edits cannot merge at all
because the whole blob is one opaque value.

**Design consequence (baked into data-model §4):**
- Where **per-field merge matters** or where concurrent edits to sub-parts are expected,
  prefer a **nested Y type** (`Y.Map`/`Y.Array`) or **flatten to stable scalar keys**, never a
  JSON blob.
- Where a value is a **stable scalar** (number, string, boolean, `null`) it is a plain `Y.Map`
  key value — fine.
- Reserve JSON-encoded blobs only for **leaf, atomically-replaced** values that never need
  sub-merge (e.g. `customData`, `roundness`, binding records), and accept LWW-per-key for them.

This is a *correctness* constraint, not a performance one, and is the single most important
representation decision in the data model.

---

## 6. Dependencies & assumptions

- The binding needs **only canonical JS `yjs` + `y-protocols`** (npm). It does **not** depend on
  the `y-crdt` Go core, the v2 codec, or any running backend — it operates on a plain `Y.Doc`
  in-process and is exercised with two in-memory `Y.Doc`s in tests. Wire encoding is **v1** (what
  y-protocols uses on the wire today); v2 is a *storage/migration* concern owned by WS-A/WS-E.
- Builds on the **merged B1 fork** (upstream 0.18.x already in). Fractional indexing,
  `isDeleted`, `customData`, and the imperative API used here are all present post-merge.
- The binding is **transport-agnostic**: it takes a `Y.Doc` (+ optional `awareness`) and an
  `ExcalidrawImperativeAPI`. Wiring it to a provider (raw-WS + y-protocols, or the
  `collaboration-service`) is WS-D/WS-C and explicitly out of scope here.
- `appState` is treated as **predominantly local** (selection, zoom, scroll, tool, view flags);
  only a tiny shared subset (scene name, view background) is a candidate for the doc, and is
  left as an OPEN question (see spec) rather than synced by default.
