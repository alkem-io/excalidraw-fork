import { reseed } from "@excalidraw/common";
import { bindBindingElement, isElbowArrow } from "@excalidraw/element";

import { pointFrom } from "@excalidraw/math";

import { actionDeleteSelected } from "@excalidraw/excalidraw/actions/actionDeleteSelected";
import { Excalidraw } from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Pointer } from "@excalidraw/excalidraw/tests/helpers/ui";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import type {
  ExcalidrawBindableElement,
  ExcalidrawElbowArrowElement,
} from "../src/types";

const { h } = window;

const mouse = new Pointer("mouse");

// ---------------------------------------------------------------------------
// Site 2 of the stale-snapshot audit: the elbow-binding branch of
// `deleteSelectedElements` (actionDeleteSelected.tsx ~line 101).
//
// When a BINDABLE element is deleted, that branch nulls each bound ELBOW arrow's
// `startBinding`/`endBinding` through the doc (`scene.mutateElement`), but the
// arrow is then returned STALE in `nextElements` (still carrying its old
// binding), which would revert the doc write.
//
// HOWEVER: `actionDeleteSelected.perform` then calls
// `fixBindingsAfterDeletion(nextElements, deleted)`, which RE-NULLS the same
// binding directly on the `nextElements` objects (bare `mutateElement`, in
// place) BEFORE they are handed to `replaceAllElements`. So the doc write that
// actually lands carries the null binding — the elbow branch's transient revert
// is re-converged in place.
//
// These tests PROVE that convergence (they must stay GREEN), and the second one
// captures the array handed to `replaceAllElements` to show the binding is null
// there despite the elbow branch's stale return.
// ---------------------------------------------------------------------------

const liveArrow = (id: string) =>
  h.elements.find((e) => e.id === id) as ExcalidrawElbowArrowElement;
const liveRect = (id: string) =>
  h.elements.find((e) => e.id === id) as ExcalidrawBindableElement;

const buildBoundElbow = () => {
  const rect1 = API.createElement({
    type: "rectangle",
    x: -150,
    y: -150,
    width: 100,
    height: 100,
  }) as ExcalidrawBindableElement;
  const rect2 = API.createElement({
    type: "rectangle",
    x: 50,
    y: 50,
    width: 100,
    height: 100,
  }) as ExcalidrawBindableElement;
  const arrow = API.createElement({
    type: "arrow",
    elbowed: true,
    x: -45,
    y: -100.1,
    width: 90,
    height: 200,
    points: [pointFrom(0, 0), pointFrom(90, 200)],
  }) as ExcalidrawElbowArrowElement;
  API.setElements([rect1, rect2, arrow]);

  bindBindingElement(arrow, rect1, "orbit", "start", h.scene);
  bindBindingElement(arrow, rect2, "orbit", "end", h.scene);

  const bound = liveArrow(arrow.id);
  expect(bound.startBinding?.elementId).toBe(rect1.id);
  expect(bound.endBinding?.elementId).toBe(rect2.id);
  // both rects carry the back-reference (symmetric start state)
  expect(
    (liveRect(rect1.id).boundElements ?? []).some((b) => b.id === arrow.id),
  ).toBe(true);
  expect(
    (liveRect(rect2.id).boundElements ?? []).some((b) => b.id === arrow.id),
  ).toBe(true);

  return { rect1, rect2, arrow };
};

describe("actionDeleteSelected — elbow-binding branch re-converges (not stale-read class)", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    mouse.reset();
  });

  it("deleting the start-bound rect unbinds the elbow arrow's start and keeps the end symmetric", () => {
    const { rect1, rect2, arrow } = buildBoundElbow();

    // Select & delete rect1 (the bindable that has the elbow arrow in its
    // boundElements; its deletion drives the elbow branch at line ~101).
    API.setSelectedElements([liveRect(rect1.id)]);
    act(() => {
      h.app.actionManager.executeAction(actionDeleteSelected);
    });

    const a = liveArrow(arrow.id);
    expect(isElbowArrow(a)).toBe(true);

    // rect1 is gone (deleted) → the arrow's start binding to it must be null.
    expect(a.startBinding?.elementId ?? null).toBe(null);

    // The OTHER end (rect2, not deleted) must remain bound AND symmetric.
    expect(a.endBinding?.elementId).toBe(rect2.id);
    expect(
      (liveRect(rect2.id).boundElements ?? []).some((b) => b.id === arrow.id),
    ).toBe(true);
  });

  it("the array handed to replaceAllElements already carries the null start binding (convergence proof)", () => {
    const { rect1, arrow } = buildBoundElbow();

    const scene = h.app.scene as unknown as {
      replaceAllElements: (n: unknown, o?: unknown) => unknown;
    };
    const orig = scene.replaceAllElements.bind(scene);
    let capturedStartBinding: unknown = "NOCALL";
    scene.replaceAllElements = (nextElements: unknown, opts?: unknown) => {
      const arr = Array.isArray(nextElements)
        ? (nextElements as { id: string; startBinding?: unknown }[])
        : [
            ...((
              nextElements as {
                values?: () => Iterable<{ id: string; startBinding?: unknown }>;
              }
            ).values?.() ?? []),
          ];
      const a = arr.find((e) => e.id === arrow.id);
      if (a) {
        capturedStartBinding = a.startBinding ?? null;
      }
      return orig(nextElements, opts);
    };

    API.setSelectedElements([liveRect(rect1.id)]);
    act(() => {
      h.app.actionManager.executeAction(actionDeleteSelected);
    });

    scene.replaceAllElements = orig;

    // Despite the elbow branch's stale return, fixBindingsAfterDeletion re-nulled
    // the binding on the returned array → the doc write lands as null.
    expect(capturedStartBinding).toBe(null);
    expect(liveArrow(arrow.id).startBinding?.elementId ?? null).toBe(null);
  });
});
