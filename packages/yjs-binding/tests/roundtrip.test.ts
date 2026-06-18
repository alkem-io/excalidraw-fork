import { describe, expect, it } from "vitest";

import { exportSceneJSON, populateYDoc } from "../src/migrate";
import { orderByIndex } from "../src/order";

import { Y, makeElement } from "./helpers";

import type { SceneJSON } from "../src/migrate";
import type { ElementRecord } from "../src/schema";

/**
 * Round-trip losslessness (US5 / SC-B-005, T025). A representative legacy scene
 * (text + arrow w/ points + image fileId + grouped + soft-deleted + customData +
 * bound text/arrows) must survive `populateYDoc → exportSceneJSON` deep-equal
 * modulo the data-model §6 normalization rules.
 */

const representativeScene = (): SceneJSON => {
  const node = makeElement({
    id: "rect-1",
    index: "a1",
    groupIds: ["group-1"],
    boundElements: [
      { id: "arrow-1", type: "arrow" },
      { id: "text-1", type: "text" },
    ],
    customData: { alkemio: { foo: "bar", n: [1, 2, 3] } },
  });
  const boundText = makeElement({
    id: "text-1",
    type: "text",
    index: "a2",
    text: "label",
    originalText: "label",
    fontSize: 16,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: "rect-1",
    lineHeight: 1.25,
    autoResize: true,
    groupIds: ["group-1"],
  });
  const arrow = makeElement({
    id: "arrow-1",
    type: "arrow",
    index: "a3",
    points: [
      [0, 0],
      [50, 50],
      [100, 0],
    ],
    startBinding: { elementId: "rect-1", focus: 0.1, gap: 4 },
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  });
  const image = makeElement({
    id: "img-1",
    type: "image",
    index: "a4",
    fileId: "file-xyz",
    status: "saved",
    scale: [1, -1],
    crop: null,
  });
  const freedraw = makeElement({
    id: "draw-1",
    type: "freedraw",
    index: "a5",
    points: [
      [0, 0],
      [1, 2],
      [3, 1],
    ],
    pressures: [0.1, 0.4, 0.8],
    simulatePressure: true,
  });
  const tombstone = makeElement({
    id: "gone-1",
    index: "a6",
    isDeleted: true,
  });

  return {
    elements: [node, boundText, arrow, image, freedraw, tombstone],
    files: {
      "file-xyz": {
        id: "file-xyz",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,AAAA",
        created: 123,
      } as never,
    },
    appState: { viewBackgroundColor: "#f5f5f5", name: "My Board" },
  };
};

/** Normalize: drop version/versionNonce/updated (data-model §6 rule 1). */
const normalize = (el: ElementRecord): ElementRecord => {
  const { version, versionNonce, updated, ...rest } = el;
  void version;
  void versionNonce;
  void updated;
  return rest;
};

describe("roundtrip: lossless JSON ↔ Y.Doc (T025 / SC-B-005)", () => {
  it("round-trips a representative scene deep-equal modulo §6 normalization", () => {
    const scene = representativeScene();
    const doc = new Y.Doc();
    populateYDoc(scene, doc);
    const out = exportSceneJSON(doc);

    // Order by index, compare element-by-element (incl. tombstones).
    const srcOrdered = orderByIndex(scene.elements).map(normalize);
    const outOrdered = orderByIndex(out.elements).map(normalize);

    expect(outOrdered).toEqual(srcOrdered);
  });

  it("preserves files verbatim (deep-equal — §6 rule 4)", () => {
    const scene = representativeScene();
    const doc = new Y.Doc();
    populateYDoc(scene, doc);
    const out = exportSceneJSON(doc);
    expect(out.files).toEqual(scene.files);
  });

  it("preserves the appState allow-list", () => {
    const scene = representativeScene();
    const doc = new Y.Doc();
    populateYDoc(scene, doc);
    const out = exportSceneJSON(doc);
    expect(out.appState).toEqual({
      viewBackgroundColor: "#f5f5f5",
      name: "My Board",
    });
  });

  it("preserves bound text + arrows (boundElements/containerId/startBinding — US5-AC2)", () => {
    const scene = representativeScene();
    const doc = new Y.Doc();
    populateYDoc(scene, doc);
    const out = exportSceneJSON(doc);

    const node = out.elements.find((e) => e.id === "rect-1")!;
    expect(node.boundElements).toEqual([
      { id: "arrow-1", type: "arrow" },
      { id: "text-1", type: "text" },
    ]);
    const text = out.elements.find((e) => e.id === "text-1")!;
    expect(text.containerId).toBe("rect-1");
    const arrow = out.elements.find((e) => e.id === "arrow-1")!;
    expect(arrow.startBinding).toEqual({
      elementId: "rect-1",
      focus: 0.1,
      gap: 4,
    });
  });

  it("carries tombstones through unchanged (§6 rule 5)", () => {
    const scene = representativeScene();
    const doc = new Y.Doc();
    populateYDoc(scene, doc);
    const out = exportSceneJSON(doc);
    const tomb = out.elements.find((e) => e.id === "gone-1")!;
    expect(tomb.isDeleted).toBe(true);
  });

  it("repairs missing indices on load, preserving source array order (§6 rule 3)", () => {
    const scene: SceneJSON = {
      elements: [
        makeElement({ id: "first", index: null }),
        makeElement({ id: "second", index: null }),
        makeElement({ id: "third", index: null }),
      ],
    };
    const doc = new Y.Doc();
    populateYDoc(scene, doc);
    const out = exportSceneJSON(doc);
    expect(out.elements.map((e) => e.id)).toEqual(["first", "second", "third"]);
    expect(out.elements.every((e) => typeof e.index === "string")).toBe(true);
  });
});
