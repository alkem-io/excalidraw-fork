import { describe, expect, it } from "vitest";

import { BINDING_ORIGIN } from "../src/origin";

import {
  StubExcalidrawAPI,
  WhiteboardBinding,
  Y,
  makeElement,
} from "./helpers";

/**
 * Echo-prevention + minimal-write tests (US2 / SC-B-003, T010/T019). One binding
 * + one recording stub; no second doc needed.
 */

describe("echo: minimal per-property writes (T010)", () => {
  it("a single-property change emits exactly one transaction writing one key", () => {
    const doc = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    const seed = makeElement({ id: "e1", strokeColor: "#000000", index: "a1" });
    api.emitChange([seed]);

    // Count transactions caused only by the next strokeColor change, and collect
    // the distinct element keys mutated by the binding.
    let txCount = 0;
    const changedKeys = new Set<string>();
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (tx.origin === BINDING_ORIGIN) {
        txCount++;
        for (const events of tx.changedParentTypes.values()) {
          for (const event of events) {
            for (const key of event.keys.keys()) {
              changedKeys.add(key);
            }
          }
        }
      }
    });

    api.emitChange([{ ...api.elements[0], strokeColor: "#ff0000" }]);

    expect(txCount).toBe(1);
    // Only strokeColor is a meaningful change; version/versionNonce/updated are
    // render metadata the editor bumps on any edit.
    const meaningful = [...changedKeys].filter(
      (k) => k !== "version" && k !== "versionNonce" && k !== "updated",
    );
    expect(meaningful).toEqual(["strokeColor"]);

    binding.destroy();
  });

  it("a no-op onChange emits no transaction", () => {
    const doc = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    api.emitChange([makeElement({ id: "n1", index: "a1" })]);

    let txCount = 0;
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (tx.origin === BINDING_ORIGIN) {
        txCount++;
      }
    });

    // Re-emit the identical element set (same version) → change gate skips it.
    api.emitChange([{ ...api.elements[0] }]);
    expect(txCount).toBe(0);

    binding.destroy();
  });
});

describe("echo: origin guard (T019 / SC-B-003)", () => {
  it("a local edit → write → own-observe cycle triggers zero re-entrant updateScene", () => {
    const doc = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    api.emitChange([makeElement({ id: "g1", index: "a1" })]);
    const baseline = api.updateSceneCalls.length;

    // A burst of local edits — none should cause the binding to re-apply its own
    // writes back onto the scene (no echo).
    for (let i = 0; i < 5; i++) {
      api.emitChange([{ ...api.elements[0], x: i * 10 }]);
    }

    // No updateScene was triggered by our own observe handler (echo guard).
    expect(api.updateSceneCalls.length).toBe(baseline);

    binding.destroy();
  });

  it("a remote apply with a RE-ENTRANT updateScene produces zero BINDING_ORIGIN writes and no runaway recursion (Fix #1)", () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    const api = new StubExcalidrawAPI();
    // Real Excalidraw re-fires onChange synchronously from inside updateScene.
    api.reentrantUpdateScene = true;
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    // Count BINDING_ORIGIN transactions caused by the remote apply (the echo).
    let bindingTx = 0;
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (tx.origin === BINDING_ORIGIN) {
        bindingTx++;
      }
    });
    // Guard against unbounded re-entrant updateScene recursion (the stack-overflow
    // symptom): cap updateScene calls and fail loudly if the loop runs away.
    const updateSceneBefore = api.updateSceneCalls.length;

    // A single remote element arrives via a second doc (origin !== BINDING_ORIGIN).
    const remoteMap = remote.getMap<Y.Map<unknown>>("elements");
    const ymap = new Y.Map<unknown>();
    remote.transact(() => {
      remoteMap.set("r1", ymap);
      for (const [k, v] of Object.entries(
        makeElement({ id: "r1", index: "a1", strokeColor: "#abcdef" }),
      )) {
        if (k !== "boundElements") {
          ymap.set(k, v as unknown);
        }
      }
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));

    // The remote element landed in the scene…
    expect(api.elements.find((e) => e.id === "r1")).toBeDefined();
    // …with NO write echoed back into the doc under our origin…
    expect(bindingTx).toBe(0);
    // …and the re-entrant onChange did not spiral (exactly one apply → one
    // updateScene; the synchronous onChange it provoked was swallowed by the
    // re-entrancy guard, so no second apply ran).
    expect(api.updateSceneCalls.length - updateSceneBefore).toBe(1);

    binding.destroy();
  });

  it("a burst of remote applies (re-entrant updateScene) never echoes (Fix #1)", () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    const api = new StubExcalidrawAPI();
    api.reentrantUpdateScene = true;
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    const remoteApi = new StubExcalidrawAPI();
    const remoteBinding = new WhiteboardBinding(
      remote,
      remoteApi.asBindingAPI(),
    );

    let bindingTx = 0;
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (tx.origin === BINDING_ORIGIN) {
        bindingTx++;
      }
    });

    // Remote peer makes 5 successive edits; each propagates to the local doc.
    remoteApi.emitChange([makeElement({ id: "m", x: 0, index: "a1" })]);
    for (let i = 1; i <= 5; i++) {
      remoteApi.emitChange([{ ...remoteApi.elements[0], x: i * 10 }]);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    }

    // Every remote x is reflected locally and nothing was echoed back.
    expect(api.elements.find((e) => e.id === "m")!.x).toBe(50);
    expect(bindingTx).toBe(0);

    binding.destroy();
    remoteBinding.destroy();
  });

  it("preserves local selection/zoom/scroll when a remote update is applied", () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    // Local user has a selection + custom viewport.
    api.appState.selectedElementIds = { local: true };
    api.appState.zoom = { value: 2 };
    api.appState.scrollX = 99;

    // A remote element arrives via a second doc's update.
    const remoteMap = remote.getMap<Y.Map<unknown>>("elements");
    const ymap = new Y.Map<unknown>();
    remote.transact(() => {
      remoteMap.set("r1", ymap);
      for (const [k, v] of Object.entries(
        makeElement({ id: "r1", index: "a1" }),
      )) {
        if (k !== "boundElements") {
          ymap.set(k, v as unknown);
        }
      }
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote)); // origin !== BINDING_ORIGIN

    // updateScene was called for the remote element, but appState passed to it
    // contains only the synced allow-list — never selection/zoom/scroll — so the
    // host's local appState is preserved.
    const lastCall = api.updateSceneCalls[api.updateSceneCalls.length - 1];
    expect(lastCall.appState).toBeDefined();
    expect(lastCall.appState).not.toHaveProperty("selectedElementIds");
    expect(lastCall.appState).not.toHaveProperty("zoom");
    expect(lastCall.appState).not.toHaveProperty("scrollX");
    expect(lastCall.captureUpdate).toBe("NEVER");
    expect(api.elements.find((e) => e.id === "r1")).toBeDefined();
    // local selection still intact on the stub's appState
    expect(api.appState.selectedElementIds).toEqual({ local: true });

    binding.destroy();
  });
});
