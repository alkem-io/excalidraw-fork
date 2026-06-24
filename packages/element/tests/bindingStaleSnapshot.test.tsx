import { reseed } from "@excalidraw/common";
import {
  isArrowElement,
  isBindableElement,
  LinearElementEditor,
} from "@excalidraw/element";

import { pointFrom } from "@excalidraw/math";

import { actionFinalize } from "@excalidraw/excalidraw/actions/actionFinalize";
import { Excalidraw } from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { UI, Pointer } from "@excalidraw/excalidraw/tests/helpers/ui";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import { defaultLang, setLanguage } from "@excalidraw/excalidraw/i18n";

import type {
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
} from "../src/types";

const { h } = window;

const mouse = new Pointer("mouse");

// ---------------------------------------------------------------------------
// Regression suite for the "stale-snapshot reverts a doc binding write" class.
//
// The Scene's element store IS the Y.Doc; `bindOrUnbindBindingElement` /
// `bindBindingElement` write the bindable TARGET's `boundElements` through the
// doc. When a finalize/delete action then returns its CAPTURED elements array
// holding a STALE copy of that target, `syncActionResult` →
// `scene.replaceAllElements` → `writeChangedKeys`/`diffBoundElements` writes the
// stale `boundElements` back, REVERTING the doc change and leaving the binding
// ASYMMETRIC:
//   arrow.{start,end}Binding.elementId === target.id
//   but target.boundElements does NOT contain the arrow.
//
// These tests assert the *back-reference* (target → arrow), which the existing
// suites never check — they only assert the forward reference (arrow → target).
// ---------------------------------------------------------------------------

/** Re-read an element live from the doc-derived scene array by id. */
const live = <T extends ExcalidrawArrowElement | ExcalidrawBindableElement>(
  id: string,
): T => h.elements.find((e) => e.id === id) as T;

/** Does `target.boundElements` contain a back-reference to `arrowId`? */
const hasBackref = (target: ExcalidrawBindableElement, arrowId: string) =>
  (target.boundElements ?? []).some((b) => b.id === arrowId);

/**
 * Assert the binding between `arrow` and every bindable it references is
 * SYMMETRIC: each bound target carries a back-reference to the arrow.
 */
const expectSymmetricBinding = (arrowId: string) => {
  const arrow = live<ExcalidrawArrowElement>(arrowId);
  expect(arrow).toBeTruthy();

  for (const end of ["startBinding", "endBinding"] as const) {
    const boundId = arrow[end]?.elementId;
    if (!boundId) {
      continue;
    }
    const target = live<ExcalidrawBindableElement>(boundId);
    expect(target).toBeTruthy();
    expect(isBindableElement(target)).toBe(true);
    // The crux: forward ref exists (arrow → target); the back-ref MUST too.
    expect({
      end,
      boundId,
      backref: hasBackref(target, arrowId),
    }).toEqual({ end, boundId, backref: true });
  }
};

describe("stale-snapshot binding revert — actionFinalize", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mouse.reset();
    await act(() => setLanguage(defaultLang));
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    h.state.width = 1920;
    h.state.height = 1080;
  });

  afterEach(() => {
    mouse.reset();
  });

  // -------------------------------------------------------------------------
  // GREEN GUARDS — the single-click finalize-with-binding branch (line ~112).
  //
  // This branch has NO prior doc mutation before bindOrUnbindBindingElement, so
  // the bindable target in the returned `newElements` array is the SAME object
  // that bindBindingElement mutated in place → the back-reference is carried
  // through and NOT reverted. These tests pin that convergence so a future
  // refactor that breaks it (e.g. mapping the array through `newElementWith`)
  // regresses loudly.
  // -------------------------------------------------------------------------
  describe("single-click finalize (branch 1) — converges, must stay symmetric", () => {
    const MIDDLE: [number, number] = [550, 100];

    it("orbit -> orbit self-bind finalize keeps a symmetric back-reference", () => {
      const rect = UI.createElement("rectangle", {
        x: 200,
        y: 200,
        width: 200,
        height: 200,
      });

      UI.clickTool("arrow");
      mouse.reset();
      mouse.clickAt(187, 300); // start on the rect LEFT orbit ring
      mouse.moveTo(...MIDDLE);
      mouse.clickAt(...MIDDLE); // commit a middle point → multi-point arrow
      mouse.moveTo(413, 300); // end on the rect RIGHT orbit ring
      mouse.clickAt(413, 300); // single click → finalize-with-binding

      const arrow = h.elements[h.elements.length - 1] as ExcalidrawArrowElement;
      expect(h.state.multiElement).toBe(null);
      expect(arrow.startBinding?.elementId).toBe(rect.id);
      expect(arrow.endBinding?.elementId).toBe(rect.id);

      expectSymmetricBinding(arrow.id);
    });

    it("END binds to a separate rect 'from elsewhere' keeps a symmetric back-reference", () => {
      const target = UI.createElement("rectangle", {
        x: 700,
        y: 200,
        width: 200,
        height: 200,
      });
      expect(target.boundElements ?? []).toHaveLength(0);

      UI.clickTool("arrow");
      mouse.reset();
      mouse.clickAt(50, 600); // start — unbound (far from target)
      mouse.moveTo(550, 100);
      mouse.clickAt(550, 100); // commit middle point
      mouse.moveTo(690, 300); // ~10px left of the rect outline (orbit)
      mouse.clickAt(690, 300); // finalize → bind end "from elsewhere"

      expect(h.state.multiElement).toBe(null);
      const arrow = h.elements.find((e) =>
        isArrowElement(e),
      ) as ExcalidrawArrowElement;
      expect(arrow.endBinding?.elementId).toBe(target.id);

      expectSymmetricBinding(arrow.id);
    });
  });

  // -------------------------------------------------------------------------
  // RED REPRO — the multi-point trailing-point-trim + re-bind branch (line ~263).
  //
  // Here the arrow is point-trimmed FIRST (`scene.mutateElement(element,
  // {points})`), which fires a recompute that DETACHES the returned array's
  // bindable from the live one. Then bindOrUnbindBindingElement re-binds the END
  // through the doc — adding the arrow to the rect's `boundElements` in the doc —
  // but the returned `newElements` still holds the STALE rect (empty
  // boundElements). replaceAllElements then reverts the doc back to empty,
  // dropping the back-reference.
  // -------------------------------------------------------------------------
  describe("trailing-point-trim re-bind (branch 2) — must not revert the back-reference", () => {
    it("Enter-finalize re-binds the END through the doc; the rect back-reference must survive", () => {
      // A bindable rect that does NOT yet list the arrow (the re-bind must ADD
      // the back-reference; a stale return would revert that ADD).
      const rect = API.createElement({
        type: "rectangle",
        x: 300,
        y: 0,
        width: 100,
        height: 100,
        boundElements: [],
      });

      // A multi-point arrow whose END is already bound to the rect, plus an
      // EXTRA trailing point past the bound endpoint (so finalize trims it and
      // re-runs the end binding through bindOrUnbindBindingElement at line ~263).
      const arrow = API.createElement({
        type: "arrow",
        x: 0,
        y: 50,
        width: 400,
        height: 0,
        points: [
          pointFrom(0, 0),
          pointFrom(200, 0),
          pointFrom(350, 50), // bound endpoint near the rect
          pointFrom(400, 200), // extra trailing point (trimmed on finalize)
        ],
        startBinding: null,
        endBinding: {
          elementId: rect.id,
          fixedPoint: [0.5, 0.5],
          mode: "orbit",
        },
      });

      API.setElements([rect, arrow]);

      const liveArrow = live<ExcalidrawArrowElement>(arrow.id);

      // Enter the multi-point finalize branch: `multiElement` set, no
      // `lastCommittedPoint` (so the trailing point is trimmed), mouse input.
      act(() => {
        h.setState({
          multiElement: liveArrow,
          selectedLinearElement: new LinearElementEditor(
            liveArrow,
            h.app.scene.getNonDeletedElementsMap(),
          ),
          lastPointerDownWith: "mouse",
          newElement: null,
        });
      });

      // Real action dispatch — exactly how the Enter key finalizes a multi-point
      // arrow (App dispatches actionFinalize with no data → branch 2).
      act(() => {
        h.app.actionManager.executeAction(actionFinalize);
      });

      const finalArrow = live<ExcalidrawArrowElement>(arrow.id);
      // Sanity: the END is still bound to the rect (forward reference intact).
      expect(finalArrow.endBinding?.elementId).toBe(rect.id);

      // The crux: the rect MUST list the arrow. On the unfixed site the stale
      // `newElements` reverts the doc's freshly-added back-reference → FAILS.
      expectSymmetricBinding(arrow.id);
    });
  });
});
