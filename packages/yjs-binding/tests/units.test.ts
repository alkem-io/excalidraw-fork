import { Awareness } from "y-protocols/awareness";
import { describe, expect, it, vi } from "vitest";

import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

import { diffFiles, readFiles } from "../src/files";
import { AwarenessRouter } from "../src/awareness";
import { nonDeleted } from "../src/apply";
import { writeDiff, areElementsSame } from "../src/diff";

import {
  StubExcalidrawAPI,
  WhiteboardBinding,
  Y,
  makeElement,
  sync,
} from "./helpers";

import type { EphemeralChannel, EphemeralEvent } from "../src/awareness";
import type { ElementRecord } from "../src/schema";

const file = (id: string, dataURL: string): BinaryFileData =>
  ({
    id,
    mimeType: "image/png",
    dataURL,
    created: 1,
  } as unknown as BinaryFileData);

describe("files: diff add/change/remove + readFiles (T009)", () => {
  it("appends, updates, and removes files", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<BinaryFileData>("files");

    let mutations = 0;
    doc.transact(() => {
      mutations = diffFiles(map, { a: file("a", "AAA") } as BinaryFiles);
    });
    expect(mutations).toBe(1);
    expect(readFiles(map)).toEqual({ a: file("a", "AAA") });

    // change a, add b
    doc.transact(() => {
      mutations = diffFiles(map, {
        a: file("a", "BBB"),
        b: file("b", "CCC"),
      } as BinaryFiles);
    });
    expect(mutations).toBe(2);

    // remove a
    doc.transact(() => {
      mutations = diffFiles(map, { b: file("b", "CCC") } as BinaryFiles);
    });
    expect(mutations).toBe(1);
    expect(Object.keys(readFiles(map))).toEqual(["b"]);

    // no-op
    doc.transact(() => {
      mutations = diffFiles(map, { b: file("b", "CCC") } as BinaryFiles);
    });
    expect(mutations).toBe(0);
  });
});

describe("files: deletion guard during async load / tombstones (Fix #3)", () => {
  const makeRoots = () => {
    const doc = new Y.Doc();
    return {
      ydoc: doc,
      elementsMap: doc.getMap<Y.Map<unknown>>("elements"),
      filesMap: doc.getMap<BinaryFileData>("files"),
      appStateMap: doc.getMap<unknown>("appState"),
    };
  };

  it("keeps a binary referenced by a tombstoned image element", () => {
    const roots = makeRoots();
    const img = makeElement({
      id: "img",
      type: "image",
      fileId: "f1",
      index: "a1",
    });
    writeDiff(roots, [], [img], undefined, {
      f1: file("f1", "BYTES"),
    } as BinaryFiles);
    expect(roots.filesMap.has("f1")).toBe(true);

    // Soft-delete the image (removed from the next array → tombstone). A benign
    // local onChange then fires WITHOUT the file in its files arg (the editor no
    // longer lists deleted-image binaries). The file must survive — the
    // tombstone still references it.
    writeDiff(roots, [img], []); // tombstone
    writeDiff(
      roots,
      [],
      [{ ...img, isDeleted: true }],
      undefined,
      {} as BinaryFiles,
    );
    expect(roots.filesMap.has("f1")).toBe(true);
  });

  it("does not delete a binary while its image element exists but files is transiently partial", () => {
    const roots = makeRoots();
    const img = makeElement({
      id: "img",
      type: "image",
      fileId: "f1",
      index: "a1",
    });
    writeDiff(roots, [], [img], undefined, {
      f1: file("f1", "BYTES"),
    } as BinaryFiles);

    // An onChange arrives mid async-load: the element is still present but the
    // files arg is empty (binary not yet (re)loaded into the editor cache).
    const writes = writeDiff(roots, [img], [img], undefined, {} as BinaryFiles);
    expect(writes).toBe(0); // nothing to do — file is protected
    expect(roots.filesMap.has("f1")).toBe(true);
  });

  it("still deletes a truly unreferenced binary", () => {
    const roots = makeRoots();
    const el = makeElement({ id: "shape", index: "a1" }); // no fileId
    writeDiff(roots, [], [el], undefined, {
      orphan: file("orphan", "X"),
    } as BinaryFiles);
    expect(roots.filesMap.has("orphan")).toBe(true);

    // No element references "orphan" and it is absent from files → delete it.
    const writes = writeDiff(roots, [el], [el], undefined, {} as BinaryFiles);
    expect(writes).toBeGreaterThan(0);
    expect(roots.filesMap.has("orphan")).toBe(false);
  });
});

describe("apply: new files propagate to the editor via addFiles", () => {
  it("addFiles is called for binaries the editor lacks", () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    api.emitChange([
      makeElement({ id: "img", type: "image", fileId: "f1", index: "a1" }),
    ]);
    sync(doc, remote);

    // A remote file lands in the doc.
    const fmap = remote.getMap<BinaryFileData>("files");
    remote.transact(() => fmap.set("f1", file("f1", "ZZZ")));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));

    expect(api.files.f1).toBeDefined();

    binding.destroy();
  });

  it("re-applies an existing fileId whose bytes changed in the doc (Fix #2)", () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    api.emitChange([
      makeElement({ id: "img", type: "image", fileId: "f1", index: "a1" }),
    ]);
    sync(doc, remote);

    // First version of the binary arrives.
    const fmap = remote.getMap<BinaryFileData>("files");
    remote.transact(() => fmap.set("f1", file("f1", "ORIGINAL")));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    expect((api.files.f1 as BinaryFileData).dataURL).toBe("ORIGINAL");

    // The SAME fileId is replaced with new bytes (image replacement). Before the
    // fix this was dropped because the id already existed locally.
    remote.transact(() => fmap.set("f1", file("f1", "REPLACED")));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    expect((api.files.f1 as BinaryFileData).dataURL).toBe("REPLACED");

    binding.destroy();
  });
});

describe("apply: buildElements seeds version metadata for first-seen elements", () => {
  it("assigns version/versionNonce when the doc element lacks them", async () => {
    const { buildElements } = await import("../src/apply");
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>("elements");
    doc.transact(() => {
      const ymap = new Y.Map<unknown>();
      map.set("v", ymap);
      ymap.set("id", "v");
      ymap.set("index", "a1");
      // deliberately NO version / versionNonce
    });
    const { elements } = buildElements(map, new Map());
    const el = elements.find((e) => e.id === "v")!;
    expect(typeof el.version).toBe("number");
    expect(typeof el.versionNonce).toBe("number");
  });
});

describe("apply: nonDeleted filter", () => {
  it("filters tombstones", () => {
    const els: ElementRecord[] = [
      makeElement({ id: "a" }),
      makeElement({ id: "b", isDeleted: true }),
    ];
    expect(nonDeleted(els).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("diff: areElementsSame edge cases", () => {
  it("detects length change and id/version change", () => {
    const a = [makeElement({ id: "x", version: 1 })];
    expect(areElementsSame(a, [])).toBe(false);
    expect(areElementsSame(a, [makeElement({ id: "x", version: 2 })])).toBe(
      false,
    );
    expect(areElementsSame(a, [makeElement({ id: "y", version: 1 })])).toBe(
      false,
    );
    const same = [{ ...a[0] }];
    expect(areElementsSame(a, same)).toBe(true);
  });
});

describe("diff: boundElements change detection in hasDiffWork", () => {
  it("a boundElements-only change still triggers a write", () => {
    const doc = new Y.Doc();
    const roots = {
      ydoc: doc,
      elementsMap: doc.getMap<Y.Map<unknown>>("elements"),
      filesMap: doc.getMap<BinaryFileData>("files"),
      appStateMap: doc.getMap<unknown>("appState"),
    };
    const el = makeElement({ id: "n", index: "a1", boundElements: null });
    writeDiff(roots, [], [el]);

    // bump version (editor would) + add a binding
    const edited: ElementRecord = {
      ...el,
      version: 2,
      boundElements: [{ id: "arr", type: "arrow" }],
    };
    const writes = writeDiff(roots, [el], [edited]);
    expect(writes).toBeGreaterThan(0);
    const nested = roots.elementsMap
      .get("n")!
      .get("boundElements") as Y.Map<string>;
    expect(nested.has("arr")).toBe(true);
  });
});

const makeChannel = () => {
  const handlers = new Set<(e: EphemeralEvent) => void>();
  const channel: EphemeralChannel = {
    send: (event) => handlers.forEach((h) => h(event)),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return channel;
};

describe("awareness: selection/idle/user/bounds routing", () => {
  it("routes selection, idle, user to awareness fields", () => {
    const awareness = new Awareness(new Y.Doc());
    const api = new StubExcalidrawAPI();
    const router = new AwarenessRouter({
      awareness,
      api: api.routerApi(),
    });

    router.onSelectionChange({ el1: true });
    router.onIdleChange("active");
    router.setUser({ username: "alice" });

    const state = awareness.getLocalState()!;
    expect(state.selectedElementIds).toEqual({ el1: true });
    expect(state.userState).toBe("active");
    expect(state.user).toEqual({ username: "alice" });

    router.destroy();
  });

  it("an incoming USER_VISIBLE_SCENE_BOUNDS event is a no-op dispatch (host consumes it)", () => {
    const awareness = new Awareness(new Y.Doc());
    const api = new StubExcalidrawAPI();
    const channel = makeChannel();
    const router = new AwarenessRouter({
      awareness,
      api: api.routerApi(),
      ephemeral: channel,
    });

    expect(() =>
      router.broadcastVisibleSceneBounds({ sceneBounds: [0, 0, 1, 1] }),
    ).not.toThrow();
    // no emoji/countdown dispatched by a bounds event
    expect(api.dispatchedEmoji).toHaveLength(0);
    expect(api.dispatchedCountdown).toHaveLength(0);

    router.destroy();
  });

  it("broadcast helpers no-op when no ephemeral channel is configured", () => {
    const awareness = new Awareness(new Y.Doc());
    const api = new StubExcalidrawAPI();
    const router = new AwarenessRouter({
      awareness,
      api: api.routerApi(),
    });
    expect(() =>
      router.broadcastEmojiReaction({ id: "e", emoji: "x", x: 0, y: 0 }),
    ).not.toThrow();
    router.destroy();
  });
});

describe("binding lifecycle: destroy detaches + is idempotent", () => {
  it("destroy stops further onChange processing and double-destroy is safe", () => {
    const doc = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI());

    binding.destroy();
    const spy = vi.spyOn(doc, "transact");
    api.emitChange([makeElement({ id: "after", index: "a1" })]);
    // no writes after destroy
    expect(spy).not.toHaveBeenCalled();
    expect(() => binding.destroy()).not.toThrow();
    spy.mockRestore();
  });

  it("seeds an empty doc from an initial scene", () => {
    const doc = new Y.Doc();
    const api = new StubExcalidrawAPI();
    const binding = new WhiteboardBinding(doc, api.asBindingAPI(), {
      initialScene: {
        elements: [makeElement({ id: "seed", index: "a1" })],
        appState: { viewBackgroundColor: "#abcabc", name: "Seeded" },
      },
    });
    expect(doc.getMap("elements").has("seed")).toBe(true);
    expect(doc.getMap("appState").get("viewBackgroundColor")).toBe("#abcabc");
    binding.destroy();
  });
});
