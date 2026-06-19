# Tasks: Per-Property Yjs Whiteboard Binding

**Input**: design docs in `specs/001-yjs-per-property-binding/` (spec.md, plan.md, data-model.md, research.md) **Repo**: `alkem-io/excalidraw-fork` · **Branch**: `feat/003-unify-collab-yjs` **Parent**: workspace epic `003-unify-collab-yjs` WS-B (B2); gates epic FR-003 / FR-008. **Tests**: included — the epic mandates ≥95% coverage (SC-008) and convergence component tests with **two in-process `Y.Doc`s** (no Go server needed).

**Prereqs (already true)**: B1 upstream-merge done (DRAFT PR #30); fractional indexing, `isDeleted`, `customData`, and the imperative API present. Needs only `yjs` + `y-protocols`.

## Format: `[ID] [P?] [Story] Description (path)`

- **[P]** = parallelizable (different files, no dependency).
- **[Story]** = the user story / FR it serves.

---

## Phase 1: Setup & schema

- [ ] T001 Scaffold `packages/yjs-binding/` package: `package.json` (deps `yjs`, `y-protocols`, `@excalidraw/element`, `@excalidraw/fractional-indexing`), `tsconfig.json`, build wiring matching the monorepo's other packages. (`packages/yjs-binding/package.json`)
- [ ] T002 Define root-name constants and the origin sentinel: `ELEMENTS`, `FILES`, `APPSTATE` (synced allow-list `viewBackgroundColor`, `name` — OPEN-2 resolved), and a unique `BINDING_ORIGIN` object. (`packages/yjs-binding/src/origin.ts`, `src/schema.ts`)
- [ ] T003 [US1] Implement `elementToYMap(element)` / `yMapToElement(ymap)` encode/decode honoring the representation tiering (scalars as plain values; JSON-leaf for `points`, `pressures`, `groupIds`, `roundness`, `startBinding`/`endBinding`/`fixedSegments`, `scale`, `crop`, `customData`; **`boundElements` → nested `Y.Map<id,"arrow"|"text">` add/remove set per §4.1**) per data-model §2/§4. Derive keys from the live element object, not a hand-list. (`packages/yjs-binding/src/schema.ts`)
- [ ] T004 Add unit tests for `schema.ts`: every base + subtype field round-trips; JSON-leaf deep-equal; scalars `===`. (`packages/yjs-binding/tests/schema.test.ts`)
- [ ] T005 [P] [US3] Implement order helpers wrapping `@excalidraw/fractional-indexing`: `orderByIndex`, `keyBetween(prev,next)`, `repairIndices` (= `syncInvalidIndices`). No bespoke ordering. (`packages/yjs-binding/src/order.ts`) — data-model §3

**Checkpoint**: an element converts losslessly to/from its `Y.Map`; ordering primitives exist.

---

## Phase 2: onChange → Y write path (US1/US2)

- [ ] T006 [US2] Implement the cheap change gate `areElementsSame(prev, next)` comparing `(id, version)` pairs (fast path to skip no-op `onChange`s). (`packages/yjs-binding/src/diff.ts`) — data-model §8 Diff
- [ ] T007 [US1] Implement per-element **per-property** delta computation: for an existing element write only changed keys (deep-compare JSON-leaf, `===` scalars; **`boundElements` diffs into its nested `Y.Map` via `set(id,type)`/`delete(id)`, §4.1**); for a new element write all keys + `keyBetween` `index`; for a removed element set `isDeleted=true` (tombstone, never `Y.Map.delete`). Also diff the `APPSTATE` allow-list (`viewBackgroundColor`, `name`) on local change. (`packages/yjs-binding/src/diff.ts`) — FR-B-001/002/006
- [ ] T008 [US1] Apply all element writes in **one** `ydoc.transact(fn, BINDING_ORIGIN)`; update `lastKnownElements`. (`packages/yjs-binding/src/diff.ts`) — FR-B-002
- [ ] T009 [P] [US1] Implement files diff in a separate map: append new `BinaryFileData`, remove dropped ids, origin-tagged. (`packages/yjs-binding/src/files.ts`) — FR-B-007
- [ ] T010 [US2] Add tests: a single-property change emits exactly one transaction writing exactly one key; a no-op `onChange` emits no transaction. (`packages/yjs-binding/tests/echo.test.ts`)

**Checkpoint**: local edits produce minimal, origin-tagged per-property Yjs writes.

---

## Phase 3: Y observe → scene apply path (US3)

- [ ] T011 [US3] Implement scene `observeDeep` + files `observe`; on each event, **echo-guard** `if (transaction.origin === BINDING_ORIGIN) return`. (`packages/yjs-binding/src/apply.ts`) — FR-B-004
- [ ] T012 [US3] Rebuild only affected elements from their `Y.Map`s; reuse unchanged local elements; do not rebuild the whole scene (O(changed)). (`packages/yjs-binding/src/apply.ts`) — NFR-B-001
- [ ] T013 [US3] Order applied elements by `index` (`orderByIndex`) and run `repairIndices` for concurrent equal-index collisions (write repairs back under `BINDING_ORIGIN`). (`packages/yjs-binding/src/apply.ts`) — data-model §3, US3-AC3
- [ ] T014 [US3] Filter tombstones for render (`getNonDeletedElements`) while retaining them in the doc; honor merged `isDeleted`. (`packages/yjs-binding/src/apply.ts`) — FR-B-006, US1-AC3
- [ ] T015 [US2] Implement the "actively editing" guard: skip replacing an element the local user is mid-editing (text edit / resize / new element), mirroring `shouldDiscardRemoteElement`'s editing checks. (`packages/yjs-binding/src/apply.ts`) — FR-B-013
- [ ] T016 [US2] Call `api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })`; apply the synced `APPSTATE` allow-list (`viewBackgroundColor`, `name`) from the doc; preserve local-only `appState` (selection/zoom/scroll/tool). (`packages/yjs-binding/src/apply.ts`) — FR-B-003

**Checkpoint**: remote per-property changes render in correct order with tombstones, no echo, no lost local selection.

---

## Phase 4: Loop guard & binding lifecycle

- [ ] T017 [US2] Wire it together in `WhiteboardBinding`: constructor `(ydoc, api, awareness?)` attaches `api.onChange`→diff and the observers→apply; seeds `lastKnownElements` from the doc. (`packages/yjs-binding/src/index.ts`) — FR-B-011
- [ ] T018 [US2] Implement `destroy()` detaching every observer + `onChange`/awareness subscription; null caches; no leaks on remount. (`packages/yjs-binding/src/index.ts`) — FR-B-012
- [ ] T019 [US2] Echo regression test: a full local-edit → write → own-observe cycle triggers **zero** re-entrant `updateScene`. (`packages/yjs-binding/tests/echo.test.ts`) — SC-B-003

---

## Phase 5: Awareness / ephemeral routing (US4 — FR-008)

- [ ] T020 [US4] Route cursor/pointer (`onPointerUpdate`), selection, and idle to `awareness.setLocalStateField`; surface remote awareness via `api.updateScene({ collaborators })` (no element mutation). (`packages/yjs-binding/src/awareness.ts`) — FR-B-008, data-model §7
- [ ] T021 [US4] Route emoji reactions / countdown timer / visible-scene-bounds to the **ephemeral** channel and dispatch incoming via `dispatchIncomingEmojiReaction` / `dispatchIncomingCountdownTimer`; **never** touch the scene doc. (`packages/yjs-binding/src/awareness.ts`) — FR-B-008
- [ ] T022 [US4] Awareness isolation test: a burst of pointer/emoji/countdown events produces **zero** scene-doc transactions and the scene snapshot is byte-identical before/after. (`packages/yjs-binding/tests/awareness.test.ts`) — SC-B-004

---

## Phase 6: Migration round-trip (US5 — FR-B-010)

- [ ] T023 [US5] Implement `populateYDoc(sceneJSON, ydoc)`: write every element to the scene map (tombstones included), files to the files map; repair missing/invalid `index`. (`packages/yjs-binding/src/migrate.ts`) — data-model §6
- [ ] T024 [US5] Implement `exportSceneJSON(ydoc)`: read back to an Excalidraw scene (ordered by `index`). (`packages/yjs-binding/src/migrate.ts`)
- [ ] T025 [US5] Round-trip test: representative scene (text+arrow `points`+image `fileId`+grouped+soft-deleted+`customData`+bound text/arrows) is deep-equal modulo the §6 normalization rules. (`packages/yjs-binding/tests/roundtrip.test.ts`) — SC-B-005

---

## Phase 7: Convergence component tests + WS-F contribution (US1 — SC-B-001/002)

- [ ] T026 [US1] Two-`Y.Doc` merge test: bindings A/B on one element; A sets position, B sets `strokeColor` while partitioned; exchange updates; assert both scenes carry both edits. (`packages/yjs-binding/tests/merge.test.ts`) — SC-B-001
- [ ] T027 [P] [US1] Same-property tiebreak test: A and B set the same key differently; after sync both converge to one deterministic value, no divergence/exception. (`packages/yjs-binding/tests/merge.test.ts`) — US1-AC2
- [ ] T028 [P] [US1] Delete-vs-edit test: A tombstones an element while B edits a property; converge to a single consistent outcome (tombstone wins render, edit retained). (`packages/yjs-binding/tests/merge.test.ts`) — US1-AC3
- [ ] T029 [P] [US3] Concurrent order test: A and B insert elements that pick equal fractional `index`; `repairIndices` converges both to identical order. (`packages/yjs-binding/tests/apply-order.test.ts`) — US3-AC3
- [ ] T030 Contribute the two-doc convergence + awareness-isolation scenarios to the shared WS-F e2e harness; ensure the package's coverage gate (≥95%) is wired into CI. (cross-repo: WS-F harness; `packages/yjs-binding` CI) — SC-B-006 / epic SC-008/SC-009

---

## Dependencies & ordering

- **Phase 1** first (schema + order primitives gate everything).
- **Phase 2** (write) and **Phase 3** (apply) depend on Phase 1; can be developed in parallel but the **loop-guard tests (Phase 4)** need both.
- **Phase 5** (awareness) is independent of 2–4 (different files) and can run in parallel.
- **Phase 6** (migration) depends only on Phase 1 (schema).
- **Phase 7** (convergence tests) depends on Phases 1–4 (and 5 for awareness isolation).

## Parallel opportunities

- T003 (schema) and T005 (order) — different files.
- T009 (files diff) parallel to T007/T008 (element diff).
- T020 (awareness presence) and T021 (ephemeral events) parallel to the write/apply work.
- T027/T028/T029 — independent test cases, parallelizable.

## Notes — OPEN questions (all ✅ RESOLVED by antst, 2026-06-18)

- **OPEN-1 — hybrid.** `boundElements` → nested `Y.Map<id,type>` add/remove set (§4.1); `points`/`pressures`/`groupIds` → JSON-leaf. Grounding: current Excalidraw is whole-element LWW, so JSON-leaf never regresses; the nested set beats it exactly where concurrency is real (binding to one node). (T002/T003/T007)
- **OPEN-2 — sync allow-list.** `viewBackgroundColor` + scene `name` sync via the `APPSTATE` `Y.Map` (they're persisted/shared today; local-only would regress). Other appState stays per-client. (T002/T007/T016)
- **OPEN-3 — bump locally.** T016 recomputes `version`/`versionNonce` on apply (keeps `hashElementsVersion()` change-detection meaningful; nonce divergence is harmless).
- **OPEN-4 — defer to core GC.** Binding never hard-deletes tombstones; doc-growth owned by the y-crdt/collaboration-service GC policy (FR-025, ADR-0001).

**Total: 30 tasks across 7 phases.** All implementable and testable in-repo with two in-process `Y.Doc`s — no Go server, no v2 codec, no running backend.
