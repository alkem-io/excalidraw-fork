import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { ELEMENTS, FILES, APPSTATE, BINDING_ORIGIN } from "./schema";
import { areElementsSame, writeDiff } from "./diff";
import { applyToScene } from "./apply";
import { AwarenessRouter } from "./awareness";
import { populateYDoc } from "./migrate";

import type * as Y from "yjs";

import type { ElementRecord } from "./schema";
import type { EditingGuard } from "./apply";
import type { EphemeralChannel } from "./awareness";
import type { Awareness } from "y-protocols/awareness";
import type { SceneJSON } from "./migrate";

/**
 * The minimal Excalidraw imperative API surface the binding drives. Declared as
 * a `Pick` so tests can supply a lightweight stub and so the package does not
 * couple to the full editor.
 */
export type BindingExcalidrawAPI = Pick<
  ExcalidrawImperativeAPI,
  | "updateScene"
  | "getSceneElementsIncludingDeleted"
  | "getFiles"
  | "addFiles"
  | "getAppState"
  | "onChange"
> &
  Partial<
    Pick<
      ExcalidrawImperativeAPI,
      "dispatchIncomingEmojiReaction" | "dispatchIncomingCountdownTimer"
    >
  >;

export type WhiteboardBindingOptions = {
  /** Optional y-protocols awareness for cursor/selection/idle routing. */
  awareness?: Awareness;
  /** Optional ephemeral channel for emoji/countdown/bounds (WS-D wires it). */
  ephemeral?: EphemeralChannel;
  /** Initial scene to seed an empty doc (initial load / migration). */
  initialScene?: SceneJSON;
  /** Returns the id of the element the local user is mid-editing, or null. */
  editingGuard?: EditingGuard;
};

/**
 * `WhiteboardBinding` owns the scene ↔ `Y.Doc` loop (data-model §9). It is
 * transport-agnostic: constructed from a `Y.Doc`, an `ExcalidrawImperativeAPI`,
 * and optional awareness — it opens no sockets and knows no server (FR-B-011).
 * One instance per mounted editor; disposable via `destroy()` (FR-B-012).
 */
export class WhiteboardBinding {
  readonly ydoc: Y.Doc;
  readonly elementsMap: Y.Map<Y.Map<unknown>>;
  readonly filesMap: Y.Map<BinaryFileData>;
  readonly appStateMap: Y.Map<unknown>;
  readonly awarenessRouter?: AwarenessRouter;

  private readonly api: BindingExcalidrawAPI;
  private readonly editingGuard?: EditingGuard;
  private lastKnownElements: ElementRecord[] = [];
  private unsubscribeOnChange?: () => void;
  private readonly observeDeepHandler: (
    events: Y.YEvent<Y.AbstractType<unknown>>[],
    transaction: Y.Transaction,
  ) => void;
  private readonly filesObserveHandler: (
    event: Y.YMapEvent<BinaryFileData>,
    transaction: Y.Transaction,
  ) => void;
  private readonly appStateObserveHandler: (
    event: Y.YMapEvent<unknown>,
    transaction: Y.Transaction,
  ) => void;
  private destroyed = false;

  constructor(
    ydoc: Y.Doc,
    api: BindingExcalidrawAPI,
    options: WhiteboardBindingOptions = {},
  ) {
    this.ydoc = ydoc;
    this.api = api;
    this.editingGuard = options.editingGuard;

    this.elementsMap = ydoc.getMap<Y.Map<unknown>>(ELEMENTS);
    this.filesMap = ydoc.getMap<BinaryFileData>(FILES);
    this.appStateMap = ydoc.getMap<unknown>(APPSTATE);

    // Seed an empty doc from the initial scene (initial load / migration).
    if (this.elementsMap.size === 0 && options.initialScene) {
      populateYDoc(options.initialScene, ydoc);
    }

    if (options.awareness) {
      this.awarenessRouter = new AwarenessRouter({
        awareness: options.awareness,
        api: {
          updateScene: api.updateScene,
          dispatchIncomingEmojiReaction:
            api.dispatchIncomingEmojiReaction ?? (() => {}),
          dispatchIncomingCountdownTimer:
            api.dispatchIncomingCountdownTimer ?? (() => {}),
        },
        ephemeral: options.ephemeral,
      });
    }

    // Apply the current doc state to the scene, seeding lastKnownElements.
    this.lastKnownElements = applyToScene({
      roots: this.roots(),
      api,
      getPrevElements: () => this.lastKnownElements,
      editingGuard: this.editingGuard,
    });

    // observe → apply (echo-guarded)
    this.observeDeepHandler = (_events, transaction) =>
      this.onDocChange(transaction);
    this.filesObserveHandler = (_event, transaction) =>
      this.onDocChange(transaction);
    this.appStateObserveHandler = (_event, transaction) =>
      this.onDocChange(transaction);
    this.elementsMap.observeDeep(this.observeDeepHandler);
    this.filesMap.observe(this.filesObserveHandler);
    this.appStateMap.observe(this.appStateObserveHandler);

    // onChange → diff
    this.unsubscribeOnChange = api.onChange((elements, appState, files) =>
      this.onSceneChange(
        elements as unknown as ElementRecord[],
        appState as unknown as Record<string, unknown>,
        files,
      ),
    );
  }

  private roots() {
    return {
      ydoc: this.ydoc,
      elementsMap: this.elementsMap,
      filesMap: this.filesMap,
      appStateMap: this.appStateMap,
    };
  }

  /** onChange → per-property Yjs write path (FR-B-002). */
  private onSceneChange(
    elements: ElementRecord[],
    appState: Record<string, unknown>,
    files: Parameters<Parameters<BindingExcalidrawAPI["onChange"]>[0]>[2],
  ): void {
    if (this.destroyed) {
      return;
    }
    // Fast path: if no element changed by (id, version), only appState/files can
    // differ — still route through writeDiff (which self-guards no-op writes).
    const elementsUnchanged = areElementsSame(this.lastKnownElements, elements);
    writeDiff(
      this.roots(),
      this.lastKnownElements,
      elements,
      appState as never,
      files as never,
    );
    if (!elementsUnchanged) {
      this.lastKnownElements = elements.map((el) => ({ ...el }));
    }
  }

  /** Yjs observe → scene apply path, echo-guarded (FR-B-004). */
  private onDocChange(transaction: Y.Transaction): void {
    if (this.destroyed) {
      return;
    }
    // Echo guard: ignore our own writes.
    if (transaction.origin === BINDING_ORIGIN) {
      return;
    }
    this.lastKnownElements = applyToScene({
      roots: this.roots(),
      api: this.api,
      getPrevElements: () => this.lastKnownElements,
      editingGuard: this.editingGuard,
    });
  }

  /** Detach every observer + subscription; no leaks on remount (FR-B-012). */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.elementsMap.unobserveDeep(this.observeDeepHandler);
    this.filesMap.unobserve(this.filesObserveHandler);
    this.appStateMap.unobserve(this.appStateObserveHandler);
    this.unsubscribeOnChange?.();
    this.unsubscribeOnChange = undefined;
    this.awarenessRouter?.destroy();
    this.lastKnownElements = [];
  }
}

export { populateYDoc, exportSceneJSON } from "./migrate";
export { areElementsSame, writeDiff, writeAppState } from "./diff";
export { applyToScene, buildElements, readAppState, nonDeleted } from "./apply";
export { AwarenessRouter } from "./awareness";
export {
  ELEMENTS,
  FILES,
  APPSTATE,
  APPSTATE_ALLOW_LIST,
  BINDING_ORIGIN,
  elementToYMap,
  yMapToElement,
  boundElementsToYMap,
  yMapToBoundElements,
  writeChangedKeys,
  diffBoundElements,
  deepEqual,
} from "./schema";
export { orderByIndex, keyBetween, keysBetween, repairIndices } from "./order";
export { diffFiles, readFiles } from "./files";

export type { ElementRecord, AppStateAllowKey } from "./schema";
export type {
  EphemeralChannel,
  EphemeralEvent,
  PointerPayload,
  EmojiReactionPayload,
  CountdownTimerPayload,
  VisibleSceneBoundsPayload,
} from "./awareness";
export type { SceneJSON } from "./migrate";
export type { EditingGuard } from "./apply";
