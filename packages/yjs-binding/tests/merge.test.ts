import { describe, expect, it } from "vitest";

import {
  StubExcalidrawAPI,
  WhiteboardBinding,
  Y,
  makeElement,
  sync,
} from "./helpers";

import type { ElementRecord } from "../src/schema";

/**
 * Two in-process `Y.Doc`s, each with its own binding + stub API. This is the
 * no-backend convergence harness the spec mandates (SC-B-001/002).
 */
const setup = () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const apiA = new StubExcalidrawAPI();
  const apiB = new StubExcalidrawAPI();
  const bindingA = new WhiteboardBinding(docA, apiA.asBindingAPI());
  const bindingB = new WhiteboardBinding(docB, apiB.asBindingAPI());
  return { docA, docB, apiA, apiB, bindingA, bindingB };
};

const find = (api: StubExcalidrawAPI, id: string): ElementRecord | undefined =>
  api.elements.find((e) => e.id === id);

describe("merge: US1 per-property convergence (T026 / SC-B-001)", () => {
  it("concurrent edits to DIFFERENT properties both survive", () => {
    const { docA, docB, apiA, apiB, bindingA, bindingB } = setup();

    // Seed one shared element and sync it to both docs.
    const seed = makeElement({
      id: "shape-1",
      x: 0,
      y: 0,
      strokeColor: "#000000",
      index: "a1",
    });
    apiA.emitChange([seed]);
    sync(docA, docB);

    // Partition: A drags (x/y), B recolors (strokeColor) — no exchange yet.
    apiA.emitChange([{ ...find(apiA, "shape-1")!, x: 200, y: 150 }]);
    apiB.emitChange([{ ...find(apiB, "shape-1")!, strokeColor: "#ff0000" }]);

    // Exchange updates both ways.
    sync(docA, docB);

    // Both docs carry A's position AND B's color.
    for (const api of [apiA, apiB]) {
      const el = find(api, "shape-1")!;
      expect(el.x).toBe(200);
      expect(el.y).toBe(150);
      expect(el.strokeColor).toBe("#ff0000");
    }

    bindingA.destroy();
    bindingB.destroy();
  });

  it("boundElements set-merge: concurrent binds to one node both survive", () => {
    const { docA, docB, apiA, apiB, bindingA, bindingB } = setup();

    const node = makeElement({
      id: "node-1",
      index: "a1",
      boundElements: null,
    });
    apiA.emitChange([node]);
    sync(docA, docB);

    // A binds arrow-1, B binds arrow-2 to the SAME node, concurrently.
    apiA.emitChange([
      {
        ...find(apiA, "node-1")!,
        boundElements: [{ id: "arrow-1", type: "arrow" }],
      },
    ]);
    apiB.emitChange([
      {
        ...find(apiB, "node-1")!,
        boundElements: [{ id: "arrow-2", type: "arrow" }],
      },
    ]);

    sync(docA, docB);

    for (const api of [apiA, apiB]) {
      const el = find(api, "node-1")!;
      const ids = (el.boundElements as Array<{ id: string }>)
        .map((b) => b.id)
        .sort();
      expect(ids).toEqual(["arrow-1", "arrow-2"]);
    }

    bindingA.destroy();
    bindingB.destroy();
  });
});

describe("merge: same-property tiebreak (T027 / US1-AC2)", () => {
  it("concurrent same-property edits converge to one deterministic value", () => {
    const { docA, docB, apiA, apiB, bindingA, bindingB } = setup();

    const seed = makeElement({ id: "s1", strokeColor: "#000000", index: "a1" });
    apiA.emitChange([seed]);
    sync(docA, docB);

    apiA.emitChange([{ ...find(apiA, "s1")!, strokeColor: "#aaaaaa" }]);
    apiB.emitChange([{ ...find(apiB, "s1")!, strokeColor: "#bbbbbb" }]);

    expect(() => sync(docA, docB)).not.toThrow();

    const colorA = find(apiA, "s1")!.strokeColor;
    const colorB = find(apiB, "s1")!.strokeColor;
    expect(colorA).toBe(colorB); // converged, no divergence
    expect(["#aaaaaa", "#bbbbbb"]).toContain(colorA);

    bindingA.destroy();
    bindingB.destroy();
  });
});

describe("merge: delete-vs-edit (T028 / US1-AC3)", () => {
  it("tombstone wins render; concurrent edit retained on the tombstone", () => {
    const { docA, docB, apiA, apiB, bindingA, bindingB } = setup();

    const seed = makeElement({
      id: "d1",
      x: 0,
      strokeColor: "#000000",
      index: "a1",
    });
    apiA.emitChange([seed]);
    sync(docA, docB);

    // A deletes (removes from array → tombstone); B edits a property concurrently.
    apiA.emitChange([]); // d1 removed from A's array
    apiB.emitChange([{ ...find(apiB, "d1")!, strokeColor: "#00ff00" }]);

    sync(docA, docB);

    // Both docs converge: element is a tombstone (isDeleted=true) → absent from
    // the rendered (non-deleted) set, but the edit is retained on the tombstone.
    for (const { docElements } of [
      { docElements: includingDeleted(docA) },
      { docElements: includingDeleted(docB) },
    ]) {
      const tomb = docElements.find((e) => e.id === "d1")!;
      expect(tomb.isDeleted).toBe(true);
      expect(tomb.strokeColor).toBe("#00ff00"); // concurrent edit retained
    }

    // Rendered scene (updateScene receives the full set incl. tombstones; the
    // host filters non-deleted for render) — assert the tombstone is flagged.
    for (const api of [apiA, apiB]) {
      const rendered = api.elements.filter((e) => e.isDeleted !== true);
      expect(rendered.find((e) => e.id === "d1")).toBeUndefined();
    }

    bindingA.destroy();
    bindingB.destroy();
  });
});

/** Read the doc's element maps directly (including tombstones). */
const includingDeleted = (doc: Y.Doc): ElementRecord[] => {
  const map = doc.getMap<Y.Map<unknown>>("elements");
  const out: ElementRecord[] = [];
  for (const [id, ymap] of map.entries()) {
    const el: ElementRecord = { id };
    for (const [k, v] of ymap.entries()) {
      if (k !== "boundElements") {
        el[k] = v;
      }
    }
    out.push(el);
  }
  return out;
};
