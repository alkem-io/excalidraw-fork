# Implementation Plan: Per-Property Yjs Whiteboard Binding

**Branch**: `feat/003-unify-collab-yjs` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md) **Repo**: `alkem-io/excalidraw-fork` (`@alkemio/excalidraw`, Excalidraw 0.18.x monorepo) **Parent epic**: workspace `003-unify-collab-yjs` — WS-B (B2). DRAFT PR alkem-io/excalidraw-fork#30. **Input**: this sub-spec's `spec.md` + the frozen epic data-model/contracts.

## Summary

Add a **new package to the Excalidraw monorepo** that binds the live Excalidraw scene to a `Y.Doc` using a **per-property** CRDT model: the scene is an id-keyed `Y.Map` whose values are per-element `Y.Map`s (one register per property), replacing whole-element `version`/`versionNonce` last-write-wins. Z-order reuses the fork's fractional `index`; deletes are tombstones (`isDeleted`); files live in a separate `Y.Map`; and all ephemeral state (cursor/emoji/countdown/idle/bounds) is routed to **y-protocols awareness**, never the persisted doc. The binding is **transport-agnostic** (operates on a `Y.Doc` + `ExcalidrawImperativeAPI` + optional `awareness`), so the WS provider and server wiring (WS-D/WS-C) plug in later. Control flow is adapted from the OSS `y-excalidraw` (diff → origin-tagged transaction → guarded observe → apply); the **data model is changed** from per-element to per-property — the structural change that delivers the US1 win.

## Technical Context

**Language/Version**: TypeScript (monorepo's TS config), React 18, Excalidraw 0.18.x. **New runtime deps**: `yjs`, `y-protocols` (canonical JS). Reuses the in-repo `@excalidraw/fractional-indexing@3.3.0`. **No** `y-websocket`/socket here (transport is WS-D). **No** dependency on the `y-crdt` Go core or the v2 codec. **Storage**: N/A (the binding is a library; persistence is the server's concern). **Testing**: `vitest` (the repo's test runner) — component tests with **two in-process `Y.Doc`s**, plus contribution to the WS-F shared e2e harness. **No Go server needed.** **Target Platform**: browser (client-web consumes the published `@alkemio/excalidraw`). **Project Type**: monorepo package (the binding) within an existing React library. **Wire encoding**: **v1** (what `y-protocols` uses on the wire today). v2 is storage/ migration (WS-A/WS-E), not this binding. **Performance/Constraints**: diff O(changed), apply touches only affected elements (NFR-B-001); ≥95% coverage (NFR-B-003 / epic SC-008); no echo, no presence-in-doc. **Scale/Scope**: thousands of elements per board; one binding per mounted editor.

## Dependencies note (explicit, per the brief)

This binding **needs neither the v2 codec nor a running backend.** It uses the **canonical JS `yjs`** library and operates on a plain in-process `Y.Doc`; the entire test suite runs with two `Y.Doc`s in one process. The CRDT wire format is **v1** (y-protocols default). It **builds on the merged B1 fork** (upstream 0.18.x already integrated — fractional indexing, `isDeleted`, `customData`, and the imperative API are present). The Go `y-crdt` core, its v2 encoder/decoder, the `collaboration-service`, and the raw-WS provider are **other work-streams** and are **not** prerequisites for building or testing this binding.

## Constitution Check

This repo is an upstream fork; it inherits the **workspace constitution** (`agents-hq/.specify/memory/constitution.md`) for cross-repo coordination and respects **upstream Excalidraw's** structure/conventions for in-repo code (no fleet Go constitution applies — this is TS/React).

| Gate | Status | Notes |
| --- | --- | --- |
| Single source of truth (this sub-spec) | PASS | One spec dir owns the binding design |
| Respect upstream structure | PASS | New package alongside existing `packages/*`; no upstream-file rewrites beyond the seam |
| Frozen epic architecture honored | PASS | id-keyed/per-property/fractional/tombstone/awareness as decided |
| Reuse over reinvention | PASS | reuse fractional indexing, `isDeleted`, imperative API; adopt y-excalidraw control flow |
| No transport/backend coupling | PASS | binding takes a `Y.Doc`; provider is WS-D |
| Ephemeral ≠ persisted (FR-008) | PASS | awareness routing is a first-class FR (FR-B-008) |
| Test coverage ≥95% (epic SC-008) | ⏳ | enforced in CI when the package lands |
| Spec ↔ epic mapping | PASS | WS-B (B2); gates epic FR-003/FR-008 |

**No blocking gate failures.**

## Project Structure

### Documentation (this sub-spec)

```text
specs/001-yjs-per-property-binding/
├── spec.md          # what + why, user stories, FR-B-*, SC-B-*, OPEN questions
├── plan.md          # this file — architecture, deps, structure, phasing
├── data-model.md    # the Y.Doc schema (the frozen contract)
├── research.md      # grounding: fork APIs, legacy model, y-excalidraw, v2 caveat
└── tasks.md         # ordered, checklist tasks for the implementation worker
```

### Source code (new package in the monorepo)

```text
packages/
├── excalidraw/            # existing — published as @alkemio/excalidraw
├── element/               # existing — element types + fractionalIndex.ts (reused)
├── fractional-indexing/   # existing — reused for z-order
└── yjs-binding/           # NEW — this work-stream
    ├── package.json       # deps: yjs, y-protocols, @excalidraw/element, @excalidraw/fractional-indexing
    ├── src/
    │   ├── index.ts           # WhiteboardBinding class — construct/destroy, wires the loops
    │   ├── schema.ts          # root-name constants, element-Y.Map ↔ element-object encode/decode, JSON-leaf rules (data-model §2/§4)
    │   ├── diff.ts            # onChange → per-property deltas; areElementsSame fast gate (§8 Diff)
    │   ├── apply.ts           # observe → updateScene; echo guard; index repair; editing guard (§8 Apply)
    │   ├── order.ts           # thin wrappers over @excalidraw/fractional-indexing (generateKeyBetween, syncInvalidIndices, orderByFractionalIndex)
    │   ├── files.ts           # files Y.Map diff/observe (append/remove)
    │   ├── awareness.ts       # pointer/selection/idle → awareness; emoji/countdown/bounds → ephemeral dispatch (§7)
    │   ├── migrate.ts         # populateYDoc(sceneJSON) + exportSceneJSON(ydoc) — lossless round-trip (§6)
    │   └── origin.ts          # the binding origin sentinel
    └── tests/
        ├── merge.test.ts          # two Y.Docs: different-prop merge, same-prop tiebreak, delete-vs-edit (US1)
        ├── echo.test.ts           # origin guard; single-key write per single-prop change (US2)
        ├── apply-order.test.ts    # remote insert order, tombstone filter, equal-index repair (US3)
        ├── awareness.test.ts      # ephemeral isolation: zero scene transactions (US4)
        └── roundtrip.test.ts      # JSON↔Y.Doc losslessness incl. points/bound/files/customData (US5)
```

**Structure Decision**: a self-contained `packages/yjs-binding` keeps the binding out of the published editor core (`packages/excalidraw`) so the editor stays transport-agnostic and the binding can be versioned/imported independently by `client-web` (WS-D). It depends on `@excalidraw/element` (types + fractional indexing) but not vice-versa.

## The seam with client-web (WS-D, not this spec)

`client-web`'s `CollaborativeExcalidrawWrapper.tsx` currently mounts `<Excalidraw>` with the socket.io `Collab`/`Portal` client. WS-D replaces that client with this binding + a y-protocols WS provider, passing the same `onChange`/`onPointerUpdate`/ `onRequestBroadcastEmojiReaction`/`onRequestBroadcastCountdownTimer` props through to the binding's awareness/ephemeral routing. The `excalidrawAPI`→`onExcalidrawAPI` prop rename (from the B1 upstream merge) is applied at that pin bump. **None of that is in this spec** — this spec ends at "the binding works against a `Y.Doc`, proven by two-doc component tests."

## Phasing

1. **Schema + order primitives** — root constants, element ↔ Y.Map encode/decode with the representation tiering, fractional-index wrappers. (data-model §2–§4)
2. **onChange → Y write path** — diff + per-property delta + origin-tagged transaction. (§8 Diff)
3. **Y observe → scene apply path** — guarded observe + affected-element rebuild + order repair + editing guard. (§8 Apply)
4. **Loop guard hardening** — prove no echo; single-key writes. (US2)
5. **Awareness/ephemeral routing** — cursor/selection/idle + emoji/countdown/ bounds, zero scene transactions. (§7, FR-B-008)
6. **Migration round-trip** — `populateYDoc` / `exportSceneJSON`, losslessness. (§6)
7. **Component tests + WS-F contribution** — two-`Y.Doc` convergence, echo, order/tombstone, awareness isolation, round-trip. (SC-B-\*)

Phases 2 and 3 depend on 1; 4 depends on 2+3; 5 is parallel to 2–4; 6 depends on 1; 7 depends on all. See `tasks.md` for the per-task ordering and file paths.

## Risks / Complexity

- **`points`/array-property representation (OPEN-1)** — JSON-leaf per-key LWW in v1; documented non-merge for intra-line concurrent vertex edits. Nested-`Y.Array` is the heavier alternative, deferred. _Highest-attention risk._
- **Doc growth from tombstones + freedraw `points` churn (OPEN-4)** — deferred to server/core GC (FR-025); flagged for WS-A/WS-C, not solved here.
- **`appState` scope (OPEN-2)** — kept fully local in v1; schema slot reserved.
- **`version`/`versionNonce` bump policy (OPEN-3)** — treat as local render metadata, bump on apply; confirm no consumer relies on cross-client nonce equality.
