import { Awareness } from "y-protocols/awareness";
import { describe, expect, it } from "vitest";

import { AwarenessRouter } from "../src/awareness";
import { BINDING_ORIGIN } from "../src/origin";

import {
  StubExcalidrawAPI,
  WhiteboardBinding,
  Y,
  makeElement,
} from "./helpers";

import type { EphemeralChannel, EphemeralEvent } from "../src/awareness";

/** A simple in-process ephemeral channel (the WS-D seam, stubbed). */
const makeChannel = () => {
  const handlers = new Set<(e: EphemeralEvent) => void>();
  const sent: EphemeralEvent[] = [];
  const channel: EphemeralChannel = {
    send: (event) => {
      sent.push(event);
      for (const h of handlers) {
        h(event);
      }
    },
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return { channel, sent };
};

describe("awareness: ephemeral isolation (T022 / SC-B-004 / FR-B-008)", () => {
  it("pointer/emoji/countdown produce ZERO scene-doc transactions", () => {
    const doc = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    // seed one element so the scene is non-empty
    api.emitChange([makeElement({ id: "x", index: "a1" })]);

    const awareness = new Awareness(new Y.Doc());
    const { channel } = makeChannel();
    const router = new AwarenessRouter({
      awareness,
      api: api.routerApi(),
      ephemeral: channel,
    });

    // Snapshot the scene doc, then fire a burst of ephemeral events.
    const before = Y.encodeStateAsUpdate(doc);
    let sceneTxns = 0;
    doc.on("afterTransaction", () => {
      sceneTxns++;
    });

    for (let i = 0; i < 10; i++) {
      router.onPointerUpdate({
        pointer: { x: i, y: i },
        button: "up",
      });
    }
    router.broadcastEmojiReaction({ id: "e1", emoji: "🎉", x: 1, y: 2 });
    router.broadcastCountdownTimer({
      remainingSeconds: 30,
      startedBy: "u1",
      active: true,
    });
    router.broadcastVisibleSceneBounds({ sceneBounds: [0, 0, 100, 100] });

    expect(sceneTxns).toBe(0);

    // Scene snapshot is byte-identical before/after the ephemeral burst.
    const after = Y.encodeStateAsUpdate(doc);
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);

    router.destroy();
    binding.destroy();
  });

  it("incoming ephemeral events dispatch to the editor's imperative API", () => {
    const api = new StubExcalidrawAPI();
    const awareness = new Awareness(new Y.Doc());
    const { channel } = makeChannel();
    const router = new AwarenessRouter({
      awareness,
      api: api.routerApi(),
      ephemeral: channel,
    });

    router.broadcastEmojiReaction({ id: "e9", emoji: "👍", x: 5, y: 6 });
    router.broadcastCountdownTimer({
      remainingSeconds: 10,
      startedBy: "u2",
      active: true,
    });

    expect(api.dispatchedEmoji).toHaveLength(1);
    expect(api.dispatchedEmoji[0]).toMatchObject({ emoji: "👍" });
    expect(api.dispatchedCountdown).toHaveLength(1);

    router.destroy();
  });

  it("remote awareness becomes collaborators via updateScene (no element mutation)", () => {
    const api = new StubExcalidrawAPI();
    const localAwareness = new Awareness(new Y.Doc());
    const router = new AwarenessRouter({
      awareness: localAwareness,
      api: api.routerApi(),
    });

    const elementsBefore = api.elements.length;
    // Simulate a remote peer's awareness state landing locally.
    localAwareness.setLocalStateField("pointer", { x: 1, y: 1 });

    const lastUpdate = api.updateSceneCalls[api.updateSceneCalls.length - 1];
    expect(lastUpdate.collaborators).toBeDefined();
    expect(lastUpdate.elements).toBeUndefined(); // no element mutation
    expect(api.elements.length).toBe(elementsBefore);

    router.destroy();
  });
});

describe("awareness: the WhiteboardBinding never routes ephemeral into the doc", () => {
  it("constructing with awareness leaves the scene doc free of presence keys", () => {
    const doc = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const awareness = new Awareness(doc);
    const binding = new WhiteboardBinding(doc, api.asBindingAPI(), {
      awareness,
    });

    api.emitChange([makeElement({ id: "z", index: "a1" })]);
    awareness.setLocalStateField("pointer", { x: 9, y: 9 });

    // The only roots in the doc are elements/files/appState — never "awareness"
    // or "pointer" or "collaborators".
    const ymap = doc.getMap<Y.Map<unknown>>("elements").get("z")!;
    expect(ymap.has("pointer")).toBe(false);
    expect(ymap.has("selectedElementIds")).toBe(false);
    expect([...ymap.keys()]).not.toContain("collaborators");

    binding.destroy();
    void BINDING_ORIGIN;
  });
});
