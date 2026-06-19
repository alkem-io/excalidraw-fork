import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import {
  BOUND_ELEMENTS_KEY,
  boundElementsToYMap,
  deepEqual,
  diffBoundElements,
  elementToYMap,
  writeChangedKeys,
  yMapToBoundElements,
  yMapToElement,
} from "../src/schema";

import { makeElement } from "./helpers";

import type { ElementRecord } from "../src/schema";

const roundtrip = (el: ElementRecord): ElementRecord => {
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<unknown>>("elements");
  doc.transact(() => map.set(el.id as string, elementToYMap(el)));
  return yMapToElement(map.get(el.id as string)!);
};

/**
 * Strip the per-peer reconciliation metadata that is intentionally NOT synced
 * through the doc (version/versionNonce/updated — RECONCILE_META_KEYS, Fix #1).
 * The round-trip is lossless for every *synced* key; these three are re-derived
 * locally on apply, so they never survive a doc round-trip.
 */
const withoutMeta = (el: ElementRecord): ElementRecord => {
  const { version: _v, versionNonce: _n, updated: _u, ...rest } = el;
  return rest;
};

describe("schema: element encode/decode (T003/T004)", () => {
  it("round-trips a base rectangle losslessly (scalars ===)", () => {
    const el = makeElement({ id: "r1", x: 5, y: 7, strokeColor: "#ff0000" });
    const back = roundtrip(el);
    // version/versionNonce/updated are reconciliation metadata, not synced.
    expect(back).toEqual(withoutMeta(el));
    expect(back.x).toBe(5);
    expect(back.strokeColor).toBe("#ff0000");
    expect("version" in back).toBe(false);
    expect("versionNonce" in back).toBe(false);
    expect("updated" in back).toBe(false);
  });

  it("round-trips a text element subtype fields", () => {
    const el = makeElement({
      id: "t1",
      type: "text",
      text: "hello",
      originalText: "hello",
      fontSize: 20,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
    });
    expect(roundtrip(el)).toEqual(withoutMeta(el));
  });

  it("round-trips JSON-leaf props by deep value equality (points/groupIds/customData)", () => {
    const el = makeElement({
      id: "l1",
      type: "line",
      points: [
        [0, 0],
        [10, 20],
        [30, 5],
      ],
      pressures: [0.1, 0.5, 0.9],
      groupIds: ["g1", "g2"],
      roundness: { type: 2, value: 32 },
      startBinding: { elementId: "x", focus: 0, gap: 1 },
      endBinding: null,
      customData: { alkemio: { nested: [1, 2, { a: true }] } },
    });
    const back = roundtrip(el);
    expect(deepEqual(back.points, el.points)).toBe(true);
    expect(deepEqual(back.groupIds, el.groupIds)).toBe(true);
    expect(deepEqual(back.customData, el.customData)).toBe(true);
    // JSON-leaf values are deep-cloned (no shared ref with the source)
    expect(back.points).not.toBe(el.points);
  });

  it("round-trips an image element scale/crop/fileId", () => {
    const el = makeElement({
      id: "img1",
      type: "image",
      fileId: "file-abc",
      status: "saved",
      scale: [1, -1],
      crop: {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        naturalWidth: 20,
        naturalHeight: 20,
      },
    });
    expect(roundtrip(el)).toEqual(withoutMeta(el));
  });

  it("does NOT sync version/versionNonce/updated through the doc (Fix #1)", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("elements");
    const el = makeElement({
      id: "meta1",
      version: 42,
      versionNonce: 99999,
      updated: 1234567890,
    });
    doc.transact(() => map.set("meta1", elementToYMap(el)));
    const ymap = map.get("meta1")!;
    expect(ymap.has("version")).toBe(false);
    expect(ymap.has("versionNonce")).toBe(false);
    expect(ymap.has("updated")).toBe(false);
  });

  it("omits undefined keys (customData absent) for round-trip symmetry", () => {
    const el = makeElement({ id: "u1" });
    delete el.customData;
    const back = roundtrip(el);
    expect("customData" in back).toBe(false);
  });
});

describe("schema: boundElements nested Y.Map (§4.1)", () => {
  it("encodes/decodes boundElements as an add/remove set", () => {
    const el = makeElement({
      id: "node1",
      boundElements: [
        { id: "arrow-1", type: "arrow" },
        { id: "text-1", type: "text" },
      ],
    });
    const back = roundtrip(el);
    // order-insensitive, materialized deterministically
    expect(back.boundElements).toEqual([
      { id: "arrow-1", type: "arrow" },
      { id: "text-1", type: "text" },
    ]);
  });

  it("materializes an empty bound map back to null", () => {
    const doc = new Y.Doc();
    const parent = doc.getMap<unknown>("p");
    const map = boundElementsToYMap(null);
    doc.transact(() => parent.set(BOUND_ELEMENTS_KEY, map));
    expect(yMapToBoundElements(map)).toBeNull();
  });

  it("resolves the 'at most one bound text' invariant by lowest id", () => {
    const doc = new Y.Doc();
    const parent = doc.getMap<unknown>("p");
    const map = new Y.Map<"arrow" | "text">();
    doc.transact(() => {
      parent.set(BOUND_ELEMENTS_KEY, map);
      map.set("text-b", "text");
      map.set("text-a", "text");
      map.set("arrow-1", "arrow");
    });
    const back = yMapToBoundElements(map)!;
    const texts = back.filter((b) => b.type === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0].id).toBe("text-a"); // lowest id kept
    expect(back.some((b) => b.id === "arrow-1")).toBe(true);
  });

  it("diffBoundElements applies only the delta (add/remove)", () => {
    const doc = new Y.Doc();
    const parent = doc.getMap<unknown>("p");
    doc.transact(() => {
      parent.set(
        BOUND_ELEMENTS_KEY,
        boundElementsToYMap([{ id: "a1", type: "arrow" }]),
      );
    });
    let mutations = 0;
    doc.transact(() => {
      mutations = diffBoundElements(parent, [
        { id: "a1", type: "arrow" },
        { id: "a2", type: "arrow" },
      ]);
    });
    expect(mutations).toBe(1); // only a2 added
    const nested = parent.get(BOUND_ELEMENTS_KEY) as Y.Map<string>;
    expect([...nested.keys()].sort()).toEqual(["a1", "a2"]);
  });
});

describe("schema: writeChangedKeys per-property diff (T007)", () => {
  it("writes only the keys that actually changed", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("elements");
    const el = makeElement({ id: "e1", x: 0, strokeColor: "#000000" });
    doc.transact(() => map.set("e1", elementToYMap(el)));

    const ymap = map.get("e1")!;
    let writes = 0;
    doc.transact(() => {
      writes = writeChangedKeys(ymap, { ...el, strokeColor: "#ff0000" });
    });
    expect(writes).toBe(1);
    expect(ymap.get("strokeColor")).toBe("#ff0000");
    expect(ymap.get("x")).toBe(0);
  });

  it("returns 0 writes when nothing changed", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("elements");
    const el = makeElement({ id: "e2" });
    doc.transact(() => map.set("e2", elementToYMap(el)));
    let writes = -1;
    doc.transact(() => {
      writes = writeChangedKeys(map.get("e2")!, { ...el });
    });
    expect(writes).toBe(0);
  });

  it("clears a property that went value → undefined (Fix #9)", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("elements");
    const el = makeElement({ id: "c1", link: "https://example.com" });
    doc.transact(() => map.set("c1", elementToYMap(el)));
    const ymap = map.get("c1")!;
    expect(ymap.get("link")).toBe("https://example.com");

    let writes = 0;
    doc.transact(() => {
      writes = writeChangedKeys(ymap, { ...el, link: undefined });
    });
    expect(writes).toBe(1);
    // the stale value must be removed, not left to resurrect on round-trip
    expect(ymap.has("link")).toBe(false);
    expect("link" in yMapToElement(ymap)).toBe(false);
  });

  it("clears a property that was dropped from the element entirely (Fix #9)", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("elements");
    const el = makeElement({ id: "c2", link: "https://example.com" });
    doc.transact(() => map.set("c2", elementToYMap(el)));
    const ymap = map.get("c2")!;

    const dropped = { ...el };
    delete dropped.link;
    let writes = 0;
    doc.transact(() => {
      writes = writeChangedKeys(ymap, dropped);
    });
    expect(writes).toBe(1);
    expect(ymap.has("link")).toBe(false);
  });

  it("treats a JSON-leaf change (points) as one key write", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("elements");
    const el = makeElement({ id: "e3", type: "line", points: [[0, 0]] });
    doc.transact(() => map.set("e3", elementToYMap(el)));
    let writes = 0;
    doc.transact(() => {
      writes = writeChangedKeys(map.get("e3")!, {
        ...el,
        points: [
          [0, 0],
          [5, 5],
        ],
      });
    });
    expect(writes).toBe(1);
  });
});

describe("schema: deepEqual", () => {
  it("compares nested objects/arrays by value, key-order-insensitive", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(null, undefined)).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
