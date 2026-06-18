import { describe, expect, it } from "vitest";

import {
  StubExcalidrawAPI,
  WhiteboardBinding,
  Y,
  makeElement,
  sync,
} from "./helpers";

import type { ElementRecord } from "../src/schema";

const setup = () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const apiA = new StubExcalidrawAPI();
  const apiB = new StubExcalidrawAPI();
  const bindingA = new WhiteboardBinding(docA, apiA.asBindingAPI());
  const bindingB = new WhiteboardBinding(docB, apiB.asBindingAPI());
  return { docA, docB, apiA, apiB, bindingA, bindingB };
};

const ids = (api: StubExcalidrawAPI): string[] =>
  api.elements.map((e) => e.id as string);

describe("apply: remote insert order (US3-AC1)", () => {
  it("a remote insert between two elements renders in correct z-position", () => {
    const { docA, docB, apiA, apiB, bindingA, bindingB } = setup();

    apiA.emitChange([
      makeElement({ id: "a", index: "a1" }),
      makeElement({ id: "c", index: "a3" }),
    ]);
    sync(docA, docB);
    expect(ids(apiB)).toEqual(["a", "c"]);

    // B inserts "b" between them (gives it an index between a1 and a3).
    apiB.emitChange([
      apiB.elements[0],
      { ...makeElement({ id: "b", index: "a2" }) },
      apiB.elements[1],
    ]);
    sync(docA, docB);

    expect(ids(apiA)).toEqual(["a", "b", "c"]);
    expect(ids(apiB)).toEqual(["a", "b", "c"]);

    bindingA.destroy();
    bindingB.destroy();
  });
});

describe("apply: tombstone filter (US3-AC2)", () => {
  it("a remote isDeleted=true element is absent from the rendered scene", () => {
    const { docA, docB, apiA, apiB, bindingA, bindingB } = setup();

    apiA.emitChange([
      makeElement({ id: "keep", index: "a1" }),
      makeElement({ id: "gone", index: "a2" }),
    ]);
    sync(docA, docB);

    // A deletes "gone".
    apiA.emitChange([apiA.elements[0]]); // gone removed from array → tombstone
    sync(docA, docB);

    // Rendered (non-deleted) set on B excludes the tombstone.
    const rendered = apiB.elements.filter((e) => e.isDeleted !== true);
    expect(rendered.map((e) => e.id)).toEqual(["keep"]);

    // But the tombstone is retained in B's doc.
    const docMap = docB.getMap<Y.Map<unknown>>("elements");
    expect(docMap.get("gone")!.get("isDeleted")).toBe(true);

    bindingA.destroy();
    bindingB.destroy();
  });
});

describe("apply: concurrent equal-index repair (T029 / US3-AC3)", () => {
  it("two clients inserting at the same gap converge to identical order", () => {
    const { docA, docB, apiA, apiB, bindingA, bindingB } = setup();

    // Shared baseline of two elements.
    apiA.emitChange([
      makeElement({ id: "base1", index: "a1" }),
      makeElement({ id: "base2", index: "a3" }),
    ]);
    sync(docA, docB);

    // A and B each insert a NEW element that picks the SAME index "a2"
    // (simulating the concurrent same-gap insert).
    apiA.emitChange([
      apiA.elements[0],
      makeElement({ id: "fromA", index: "a2" }),
      apiA.elements[1],
    ]);
    apiB.emitChange([
      apiB.elements[0],
      makeElement({ id: "fromB", index: "a2" }),
      apiB.elements[1],
    ]);

    sync(docA, docB);

    // Both converge to identical order after repairIndices.
    expect(ids(apiA)).toEqual(ids(apiB));
    // base1 first, base2 last; the two colliders in the middle, deterministic.
    expect(ids(apiA)[0]).toBe("base1");
    expect(ids(apiA)[3]).toBe("base2");
    expect(ids(apiA).slice(1, 3).sort()).toEqual(["fromA", "fromB"]);

    // And the indices are now strictly increasing on both.
    for (const api of [apiA, apiB]) {
      const indices = api.elements.map((e) => e.index as string);
      const sorted = [...indices].sort();
      expect(indices).toEqual(sorted);
      expect(new Set(indices).size).toBe(indices.length); // no dupes
    }

    bindingA.destroy();
    bindingB.destroy();
  });
});

describe("apply: editing guard (FR-B-013)", () => {
  it("does not replace an element the local user is mid-editing", () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    const api = new StubExcalidrawAPI();
    let editingId: string | null = null;
    const binding = new WhiteboardBinding(doc, api.asBindingAPI(), {
      editingGuard: () => editingId,
    });

    api.emitChange([makeElement({ id: "edit-me", x: 0, index: "a1" })]);
    sync(doc, remote);

    // User starts editing "edit-me" locally (local x = 500, not yet in doc).
    editingId = "edit-me";
    const localEditing: ElementRecord = { ...api.elements[0], x: 500 };
    api.elements = [localEditing];

    // A remote update changes the same element's x to 999.
    const rmap = remote.getMap<Y.Map<unknown>>("elements");
    remote.transact(() => {
      rmap.get("edit-me")!.set("x", 999);
      rmap.get("edit-me")!.set("version", 99);
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));

    // The guard kept the local mid-edit copy (x = 500), not the remote (999).
    expect(api.elements.find((e) => e.id === "edit-me")!.x).toBe(500);

    binding.destroy();
  });
});
