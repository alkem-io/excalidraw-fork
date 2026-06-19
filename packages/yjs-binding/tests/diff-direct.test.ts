import { describe, expect, it } from "vitest";

import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

import { writeDiff, writeAppState } from "../src/diff";
import {
  deepEqual,
  diffBoundElements,
  elementToYMap,
  writeChangedKeys,
} from "../src/schema";

import { Y, makeElement } from "./helpers";

import type { ElementRecord } from "../src/schema";

const makeRoots = () => {
  const doc = new Y.Doc();
  return {
    ydoc: doc,
    elementsMap: doc.getMap<Y.Map<unknown>>("elements"),
    filesMap: doc.getMap<BinaryFileData>("files"),
    appStateMap: doc.getMap<unknown>("appState"),
  };
};

describe("writeDiff: new element index generation (findPrev/findNext)", () => {
  it("generates an index between ordered neighbours for an indexless insert", () => {
    const roots = makeRoots();
    // two anchored elements
    writeDiff(
      roots,
      [],
      [
        makeElement({ id: "a", index: "a1" }),
        makeElement({ id: "c", index: "a3" }),
      ],
    );

    // insert "b" with NO index between a and c (ordered array position)
    const next: ElementRecord[] = [
      makeElement({ id: "a", index: "a1" }),
      makeElement({ id: "b", index: null }),
      makeElement({ id: "c", index: "a3" }),
    ];
    writeDiff(roots, [], next);

    const bIndex = roots.elementsMap.get("b")!.get("index") as string;
    expect(bIndex > "a1").toBe(true);
    expect(bIndex < "a3").toBe(true);
  });

  it("does NOT throw / abort the write when the input array is not index-sorted (Fix #8)", () => {
    const roots = makeRoots();
    // An unsorted onChange: descending indices around an indexless insert. Before
    // the fix, generateKeyBetween(prev,next) with prev>=next threw and aborted
    // the ENTIRE write, losing every element.
    const next: ElementRecord[] = [
      makeElement({ id: "hi", index: "a3" }),
      makeElement({ id: "mid", index: null }), // insert between a3 and a1 (descending)
      makeElement({ id: "lo", index: "a1" }),
    ];
    let writes = 0;
    expect(() => {
      writes = writeDiff(roots, [], next);
    }).not.toThrow();
    expect(writes).toBeGreaterThan(0);
    // All three elements were written — none lost to an aborted transaction.
    expect(roots.elementsMap.has("hi")).toBe(true);
    expect(roots.elementsMap.has("mid")).toBe(true);
    expect(roots.elementsMap.has("lo")).toBe(true);
    // the indexless insert got SOME valid fractional key
    expect(typeof roots.elementsMap.get("mid")!.get("index")).toBe("string");
  });

  it("generates indices for a fully-indexless batch", () => {
    const roots = makeRoots();
    writeDiff(
      roots,
      [],
      [
        makeElement({ id: "x", index: null }),
        makeElement({ id: "y", index: null }),
      ],
    );
    const xi = roots.elementsMap.get("x")!.get("index") as string;
    const yi = roots.elementsMap.get("y")!.get("index") as string;
    expect(typeof xi).toBe("string");
    expect(typeof yi).toBe("string");
    expect(xi).not.toBe(yi);
  });
});

describe("writeDiff: removal → tombstone (FR-B-006)", () => {
  it("sets isDeleted=true, never deletes the map entry, never syncs version (Fix #1/#5)", () => {
    const roots = makeRoots();
    const el = makeElement({ id: "d", index: "a1", version: 4 });
    writeDiff(roots, [], [el]);

    const writes = writeDiff(roots, [el], []); // removed from next
    expect(writes).toBeGreaterThan(0);
    const ymap = roots.elementsMap.get("d")!;
    expect(ymap.get("isDeleted")).toBe(true);
    // version is reconciliation metadata, never written to the doc — the old
    // non-monotonic tombstone version write is gone (Fix #5 subsumed by Fix #1).
    expect(ymap.has("version")).toBe(false);
    expect(roots.elementsMap.has("d")).toBe(true); // entry retained

    // removing an already-tombstoned element is a no-op
    const again = writeDiff(roots, [{ ...el, isDeleted: true }], []);
    expect(again).toBe(0);
  });
});

describe("writeDiff: files + appState branches", () => {
  it("writes file and appState deltas", () => {
    const roots = makeRoots();
    const files: BinaryFiles = {
      f: { id: "f", mimeType: "image/png", dataURL: "X", created: 1 } as never,
    };
    const writes = writeDiff(
      roots,
      [],
      [makeElement({ id: "e", index: "a1" })],
      { viewBackgroundColor: "#123456", name: "Board" } as never,
      files,
    );
    expect(writes).toBeGreaterThan(0);
    expect(roots.filesMap.has("f")).toBe(true);
    expect(roots.appStateMap.get("viewBackgroundColor")).toBe("#123456");
    expect(roots.appStateMap.get("name")).toBe("Board");
  });

  it("writeAppState skips undefined keys and no-op equal values", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("appState");
    doc.transact(() => {
      expect(writeAppState(map, { viewBackgroundColor: "#fff" })).toBe(1);
    });
    doc.transact(() => {
      expect(writeAppState(map, { viewBackgroundColor: "#fff" })).toBe(0);
    });
    doc.transact(() => {
      expect(writeAppState(map, {})).toBe(0);
    });
  });
});

describe("schema: writeChangedKeys boundElements + diffBoundElements no-nested branch", () => {
  it("writeChangedKeys diffs boundElements via the nested map", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("elements");
    const el = makeElement({
      id: "n",
      boundElements: [{ id: "a1", type: "arrow" }],
    });
    doc.transact(() => map.set("n", elementToYMap(el)));

    let writes = 0;
    doc.transact(() => {
      writes = writeChangedKeys(map.get("n")!, {
        ...el,
        boundElements: [
          { id: "a1", type: "arrow" },
          { id: "t1", type: "text" },
        ],
      });
    });
    expect(writes).toBe(1); // one add
  });

  it("diffBoundElements installs a nested map when the value is missing/non-map", () => {
    const doc = new Y.Doc();
    const parent = doc.getMap<unknown>("p");
    let mutations = 0;
    doc.transact(() => {
      mutations = diffBoundElements(parent, [{ id: "x", type: "arrow" }]);
    });
    expect(mutations).toBe(1);
    expect((parent.get("boundElements") as Y.Map<string>).get("x")).toBe(
      "arrow",
    );
  });
});

describe("writeDiff: hasDiffWork boundElements branches", () => {
  it("detects a same-size type change and a size change; ignores no-op", () => {
    const roots = makeRoots();
    const el = makeElement({
      id: "n",
      index: "a1",
      boundElements: [{ id: "b1", type: "arrow" }],
    });
    writeDiff(roots, [], [el]);

    // same id, type changes arrow→text (same size) → write
    const typeChanged: ElementRecord = {
      ...el,
      version: 2,
      boundElements: [{ id: "b1", type: "text" }],
    };
    expect(writeDiff(roots, [el], [typeChanged])).toBeGreaterThan(0);

    // size change (add one) → write
    const sizeChanged: ElementRecord = {
      ...typeChanged,
      version: 3,
      boundElements: [
        { id: "b1", type: "text" },
        { id: "b2", type: "arrow" },
      ],
    };
    expect(writeDiff(roots, [typeChanged], [sizeChanged])).toBeGreaterThan(0);

    // identical boundElements + same version + no other change → no write
    expect(writeDiff(roots, [sizeChanged], [sizeChanged])).toBe(0);
  });

  it("a file removal-only change triggers a write", () => {
    const roots = makeRoots();
    const files: BinaryFiles = {
      f: { id: "f", mimeType: "image/png", dataURL: "X", created: 1 } as never,
    };
    writeDiff(
      roots,
      [],
      [makeElement({ id: "e", index: "a1" })],
      undefined,
      files,
    );
    // now drop the file
    const writes = writeDiff(
      roots,
      [makeElement({ id: "e", index: "a1" })],
      [makeElement({ id: "e", index: "a1" })],
      undefined,
      {} as BinaryFiles,
    );
    expect(writes).toBeGreaterThan(0);
    expect(roots.filesMap.has("f")).toBe(false);
  });
});

describe("schema: deepEqual structural branches", () => {
  it("covers array-vs-object, length mismatch, missing key, null/undefined", () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false); // array vs object
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false); // length
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false); // missing key
    expect(deepEqual(1, "1")).toBe(false); // primitive mismatch
    expect(deepEqual(null, 0)).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });
});

describe("schema: elementToYMap omits undefined keys", () => {
  it("does not store keys whose value is undefined", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("e");
    const el = makeElement({ id: "u" });
    el.customData = undefined;
    doc.transact(() => map.set("u", elementToYMap(el)));
    expect(map.get("u")!.has("customData")).toBe(false);
  });
});
