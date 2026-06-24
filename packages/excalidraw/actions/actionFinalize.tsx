import { pointFrom } from "@excalidraw/math";

import { bindOrUnbindBindingElement } from "@excalidraw/element/binding";
import {
  isValidPolygon,
  LinearElementEditor,
  newElementWith,
} from "@excalidraw/element";

import {
  isBindingElement,
  isFreeDrawElement,
  isLinearElement,
  isLineElement,
} from "@excalidraw/element";

import {
  KEYS,
  arrayToMap,
  invariant,
  shouldRotateWithDiscreteAngle,
  updateActiveTool,
} from "@excalidraw/common";
import { isPathALoop } from "@excalidraw/element";

import { isInvisiblySmallElement } from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeleted,
  PointsPositionUpdates,
} from "@excalidraw/element/types";

import { t } from "../i18n";
import { resetCursor } from "../cursor";
import { done } from "../components/icons";
import { ToolButton } from "../components/ToolButton";

import { register } from "./register";

import type { AppState } from "../types";

type FormData = {
  event: PointerEvent;
  sceneCoords: { x: number; y: number };
};

export const actionFinalize = register<FormData>({
  name: "finalize",
  label: "",
  trackEvent: false,
  perform: (elements, appState, data, app) => {
    let shouldCommit = true;
    let newElements = elements;
    const { interactiveCanvas, focusContainer, scene } = app;
    const elementsMap = scene.getNonDeletedElementsMap();

    // fresh-snapshot: ids of the bindable TARGETS whose `boundElements`
    // bindOrUnbindBindingElement wrote through the doc below. The returned
    // `newElements`/`elements` array can hold a STALE copy of such a target
    // (detached by the point-trim recompute), so we re-read ONLY these ids live
    // from the doc at the return — never the primary arrow, whose finalize state
    // (trimmed points / tombstone flag) lives only in the returned copy.
    const reboundTargetIds = new Set<string>();
    // Capture both the BEFORE and AFTER binding targets around each (un)bind: an
    // unbind empties the OLD target's `boundElements` in the doc (so the stale
    // return would re-add a phantom back-ref), while a bind fills the NEW
    // target's — re-reading both ids fresh covers either direction.
    const trackReboundTargets = (
      arrow: NonDeleted<ExcalidrawLinearElement> | null,
    ) => {
      if (arrow?.startBinding?.elementId) {
        reboundTargetIds.add(arrow.startBinding.elementId);
      }
      if (arrow?.endBinding?.elementId) {
        reboundTargetIds.add(arrow.endBinding.elementId);
      }
    };
    // Re-read the side-effected bindable targets fresh from the doc, leaving the
    // primary arrow (and every other element) as the returned copy.
    const freshenReboundTargets = (
      arr: readonly ExcalidrawElement[],
    ): readonly ExcalidrawElement[] => {
      if (reboundTargetIds.size === 0) {
        return arr;
      }
      const freshMap = scene.getNonDeletedElementsMap();
      return arr.map((element) =>
        reboundTargetIds.has(element.id)
          ? freshMap.get(element.id) ?? element
          : element,
      );
    };

    if (data && appState.selectedLinearElement) {
      const { event, sceneCoords } = data;
      const element = LinearElementEditor.getElement(
        appState.selectedLinearElement.elementId,
        elementsMap,
      );

      invariant(
        element,
        "Arrow element should exist if selectedLinearElement is set",
      );

      invariant(
        sceneCoords,
        "sceneCoords should be defined if actionFinalize is called with event",
      );

      const linearElementEditor = LinearElementEditor.handlePointerUp(
        event,
        appState.selectedLinearElement,
        appState,
        app.scene,
      );

      if (
        isBindingElement(element) &&
        !appState.selectedLinearElement.segmentMidPointHoveredCoords
      ) {
        const newArrow = !!appState.newElement;

        const selectedPointsIndices =
          newArrow || !appState.selectedLinearElement.selectedPointsIndices
            ? [element.points.length - 1] // New arrow creation
            : appState.selectedLinearElement.selectedPointsIndices;

        const draggedPoints: PointsPositionUpdates =
          selectedPointsIndices.reduce((map, index) => {
            map.set(index, {
              point: LinearElementEditor.pointFromAbsoluteCoords(
                element,
                pointFrom<GlobalPoint>(
                  sceneCoords.x - linearElementEditor.pointerOffset.x,
                  sceneCoords.y - linearElementEditor.pointerOffset.y,
                ),
                elementsMap,
              ),
            });

            return map;
          }, new Map()) ?? new Map();
        // targets bound BEFORE this (un)bind (an unbind clears one of these)
        trackReboundTargets(element);
        bindOrUnbindBindingElement(
          element,
          draggedPoints,
          sceneCoords.x - linearElementEditor.pointerOffset.x,
          sceneCoords.y - linearElementEditor.pointerOffset.y,
          scene,
          appState,
          {
            newArrow,
            altKey: event.altKey,
            angleLocked: shouldRotateWithDiscreteAngle(event),
          },
        );
        // targets bound AFTER — re-read the arrow fresh, since
        // bindOrUnbindBindingElement wrote its bindings through the doc and the
        // captured `element` may not reflect them.
        trackReboundTargets(
          scene.getElement(
            element.id,
          ) as NonDeleted<ExcalidrawLinearElement> | null,
        );
      } else if (isLineElement(element)) {
        if (
          appState.selectedLinearElement?.isEditing &&
          !appState.newElement &&
          !isValidPolygon(element.points)
        ) {
          scene.mutateElement(element, {
            polygon: false,
          });
        }
      }

      if (linearElementEditor !== appState.selectedLinearElement) {
        // `handlePointerUp()` updated the linear element instance,
        // so filter out this element if it is too small,
        // but do an update to all new elements anyway for undo/redo purposes.

        if (element && isInvisiblySmallElement(element)) {
          // TODO: #7348 in theory this gets recorded by the store, so the invisible elements could be restored by the undo/redo, which might be not what we would want
          newElements = newElements.map((el) => {
            if (el.id === element.id) {
              return newElementWith(el, {
                isDeleted: true,
              });
            }
            return el;
          });
        }

        const activeToolLocked = appState.activeTool?.locked;

        return {
          elements: freshenReboundTargets(
            element.points.length < 2 || isInvisiblySmallElement(element)
              ? elements.map((el) => {
                  if (el.id === element.id) {
                    return newElementWith(el, { isDeleted: true });
                  }
                  return el;
                })
              : newElements,
          ),
          appState: {
            ...appState,
            cursorButton: "up",
            selectedLinearElement: activeToolLocked
              ? null
              : {
                  ...linearElementEditor,
                  selectedPointsIndices: null,
                  isEditing: false,
                  initialState: {
                    ...linearElementEditor.initialState,
                    lastClickedPoint: -1,
                  },
                  pointerOffset: { x: 0, y: 0 },
                },
            selectionElement: null,
            suggestedBinding: null,
            newElement: null,
            multiElement: null,
          },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        };
      }
    }

    if (window.document.activeElement instanceof HTMLElement) {
      focusContainer();
    }

    let element: NonDeleted<ExcalidrawElement> | null = null;
    if (appState.multiElement) {
      // Fresh-snapshot (native-Yjs core): `appState.multiElement` is a held
      // reference that no longer tracks the doc after the editor appended points
      // with `informMutation:false`. Re-read the live element so the finalize
      // logic (point trim, `isInvisiblySmallElement`) sees the committed points —
      // a stale snapshot would look degenerate and wrongly tombstone the element.
      element =
        (scene.getElement(
          appState.multiElement.id,
        ) as typeof appState.multiElement) ?? appState.multiElement;
    } else if (
      appState.newElement?.type === "freedraw" ||
      isBindingElement(appState.newElement)
    ) {
      element =
        (scene.getElement(
          appState.newElement.id,
        ) as typeof appState.newElement) ?? appState.newElement;
    } else if (Object.keys(appState.selectedElementIds).length === 1) {
      const candidate = elementsMap.get(
        Object.keys(appState.selectedElementIds)[0],
      ) as NonDeleted<ExcalidrawLinearElement> | undefined;
      if (candidate) {
        element = candidate;
      }
    }

    if (element) {
      // pen and mouse have hover
      if (
        appState.selectedLinearElement &&
        appState.multiElement &&
        element.type !== "freedraw" &&
        appState.lastPointerDownWith !== "touch"
      ) {
        const { points } = element;
        const { lastCommittedPoint } = appState.selectedLinearElement;
        if (
          !lastCommittedPoint ||
          points[points.length - 1] !== lastCommittedPoint
        ) {
          shouldCommit = false;
          scene.mutateElement(element, {
            points: element.points.slice(0, -1),
          });
          if (
            isBindingElement(element) &&
            element.endBinding &&
            // after slicing the trailing point a <2-point arrow may be left
            element.points.length > 1
          ) {
            const newArrow = !!appState.newElement;
            const draggedPoints: PointsPositionUpdates = new Map([
              [
                element.points.length - 1,
                {
                  point: element.points[element.points.length - 1],
                  isDragging: false,
                },
              ],
            ]);
            const globalPoint =
              LinearElementEditor.getPointAtIndexGlobalCoordinates(
                element,
                -1,
                elementsMap,
              );
            // targets bound BEFORE this (un)bind
            trackReboundTargets(element);
            bindOrUnbindBindingElement(
              element,
              draggedPoints,
              globalPoint[0],
              globalPoint[1],
              scene,
              appState,
              {
                newArrow,
              },
            );
            // targets bound AFTER. The trailing-point trim above
            // (`scene.mutateElement(element, { points })`) fired a recompute that
            // detached the returned array's copy of this target from the live
            // one, so bindOrUnbindBindingElement's doc write to its
            // `boundElements` would otherwise be reverted by the stale return —
            // re-read it fresh at the return instead.
            trackReboundTargets(
              scene.getElement(
                element.id,
              ) as NonDeleted<ExcalidrawLinearElement> | null,
            );
          }
        }
      }

      if (element && isInvisiblySmallElement(element)) {
        // TODO: #7348 in theory this gets recorded by the store, so the invisible elements could be restored by the undo/redo, which might be not what we would want
        newElements = newElements.map((el) => {
          if (el.id === element?.id) {
            return newElementWith(el, { isDeleted: true });
          }
          return el;
        });
      }

      if (isLinearElement(element) || isFreeDrawElement(element)) {
        // If the multi point line closes the loop,
        // set the last point to first point.
        // This ensures that loop remains closed at different scales.
        const isLoop = isPathALoop(element.points, appState.zoom.value);

        if (isLoop && (isLineElement(element) || isFreeDrawElement(element))) {
          const linePoints = element.points;
          const firstPoint = linePoints[0];
          const points: LocalPoint[] = linePoints.map((p, index) =>
            index === linePoints.length - 1
              ? pointFrom(firstPoint[0], firstPoint[1])
              : p,
          );
          if (isLineElement(element)) {
            scene.mutateElement(element, {
              points,
              polygon: true,
            });
          } else {
            scene.mutateElement(element, {
              points,
            });
          }
        }

        if (isLineElement(element) && !isValidPolygon(element.points)) {
          scene.mutateElement(element, {
            polygon: false,
          });
        }
      }
    }

    if (
      (!appState.activeTool.locked &&
        appState.activeTool.type !== "freedraw") ||
      !element
    ) {
      resetCursor(interactiveCanvas);
    }

    let activeTool: AppState["activeTool"];
    if (appState.activeTool.type === "eraser") {
      activeTool = updateActiveTool(appState, {
        ...(appState.activeTool.lastActiveTool || {
          type: app.state.preferredSelectionTool.type,
        }),
        lastActiveToolBeforeEraser: null,
      });
    } else {
      activeTool = updateActiveTool(appState, {
        type: app.state.preferredSelectionTool.type,
      });
    }

    let selectedLinearElement =
      element && isLinearElement(element)
        ? new LinearElementEditor(element, arrayToMap(newElements)) // To select the linear element when user has finished mutipoint editing
        : appState.selectedLinearElement;

    selectedLinearElement = selectedLinearElement
      ? {
          ...selectedLinearElement,
          isEditing: appState.newElement
            ? false
            : selectedLinearElement.isEditing,
          initialState: {
            ...selectedLinearElement.initialState,
            lastClickedPoint: -1,
            origin: null,
          },
        }
      : selectedLinearElement;

    return {
      elements: freshenReboundTargets(newElements),
      appState: {
        ...appState,
        cursorButton: "up",
        activeTool:
          (appState.activeTool.locked ||
            appState.activeTool.type === "freedraw") &&
          element
            ? appState.activeTool
            : activeTool,
        activeEmbeddable: null,
        newElement: null,
        selectionElement: null,
        multiElement: null,
        editingTextElement: null,
        suggestedBinding: null,
        frameToHighlight: null,
        selectedElementIds:
          element &&
          !appState.activeTool.locked &&
          appState.activeTool.type !== "freedraw"
            ? {
                ...appState.selectedElementIds,
                [element.id]: true,
              }
            : appState.selectedElementIds,

        selectedLinearElement,
      },
      // TODO: #7348 we should not capture everything, but if we don't, it leads to incosistencies -> revisit
      captureUpdate: shouldCommit
        ? CaptureUpdateAction.IMMEDIATELY
        : CaptureUpdateAction.NEVER,
    };
  },
  keyTest: (event, appState) =>
    (event.key === KEYS.ESCAPE && appState.selectedLinearElement?.isEditing) ||
    ((event.key === KEYS.ESCAPE || event.key === KEYS.ENTER) &&
      appState.multiElement !== null),
  PanelComponent: ({ appState, updateData, data }) => (
    <ToolButton
      type="button"
      icon={done}
      title={t("buttons.done")}
      aria-label={t("buttons.done")}
      onClick={updateData}
      visible={appState.multiElement != null}
      size={data?.size || "medium"}
      style={{ pointerEvents: "all" }}
    />
  ),
});
