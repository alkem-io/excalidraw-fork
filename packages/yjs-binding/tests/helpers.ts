import * as Y from "yjs";

import { WhiteboardBinding } from "../src/index";

import type { AwarenessRouter } from "../src/awareness";
import type { BindingExcalidrawAPI } from "../src/index";
import type { ElementRecord } from "../src/schema";

/**
 * A recording stub of the Excalidraw imperative API surface the binding drives.
 * Holds an in-memory element/file/appState store, fires `onChange` subscribers,
 * and counts `updateScene` calls so tests can assert echo behavior.
 */
export class StubExcalidrawAPI {
  elements: ElementRecord[] = [];
  files: Record<string, unknown> = {};
  /**
   * When true, `updateScene` re-fires `onChange` synchronously — exactly like
   * real Excalidraw (App.componentDidUpdate → onChangeEmitter). Off by default
   * so the legacy tests (whose stub `updateScene` is a silent no-op) keep
   * working; the echo test flips it on to exercise the re-entrancy guard.
   */
  reentrantUpdateScene = false;
  appState: Record<string, unknown> = {
    viewBackgroundColor: "#ffffff",
    name: "Untitled",
    selectedElementIds: {},
    zoom: { value: 1 },
    scrollX: 0,
    scrollY: 0,
  };
  collaborators = new Map<string, unknown>();

  updateSceneCalls: Array<{
    elements?: ElementRecord[];
    appState?: Record<string, unknown>;
    collaborators?: Map<string, unknown>;
    captureUpdate?: string;
  }> = [];

  private changeHandlers = new Set<
    (
      elements: readonly ElementRecord[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => void
  >();

  dispatchedEmoji: unknown[] = [];
  dispatchedCountdown: unknown[] = [];

  updateScene = (sceneData: {
    elements?: ElementRecord[];
    appState?: Record<string, unknown> | null;
    collaborators?: Map<string, unknown>;
    captureUpdate?: string;
  }): void => {
    this.updateSceneCalls.push({
      elements: sceneData.elements,
      appState: sceneData.appState ?? undefined,
      collaborators: sceneData.collaborators,
      captureUpdate: sceneData.captureUpdate,
    });
    if (sceneData.elements) {
      this.elements = sceneData.elements.map((el) => ({ ...el }));
    }
    if (sceneData.appState) {
      this.appState = { ...this.appState, ...sceneData.appState };
    }
    if (sceneData.collaborators) {
      this.collaborators = sceneData.collaborators;
    }
    // Real Excalidraw emits onChange synchronously after the scene updates
    // (componentDidUpdate → onChangeEmitter). When enabled, replay that here so
    // the binding's re-entrancy guard is exercised. We re-fire with the SCENE's
    // current elements verbatim (no version re-bump — the editor does not invent
    // a new version just because updateScene ran).
    if (this.reentrantUpdateScene && sceneData.elements) {
      for (const handler of this.changeHandlers) {
        handler(this.elements, this.appState, this.files ?? {});
      }
    }
  };

  getSceneElementsIncludingDeleted = (): ElementRecord[] => this.elements;

  getFiles = (): Record<string, unknown> => this.files;

  addFiles = (data: Array<{ id: string }>): void => {
    for (const file of data) {
      this.files[file.id] = file;
    }
  };

  getAppState = (): Record<string, unknown> => this.appState;

  onChange = (
    cb: (
      elements: readonly ElementRecord[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => void,
  ): (() => void) => {
    this.changeHandlers.add(cb);
    return () => this.changeHandlers.delete(cb);
  };

  dispatchIncomingEmojiReaction = (payload: unknown): void => {
    this.dispatchedEmoji.push(payload);
  };

  dispatchIncomingCountdownTimer = (payload: unknown): void => {
    this.dispatchedCountdown.push(payload);
  };

  /**
   * Simulate the editor emitting an onChange after a local edit. Mirrors the
   * real editor's `mutateElement`: any element whose content changed relative to
   * the current scene gets its `version`/`versionNonce` bumped, so the binding's
   * `(id, version)` change gate (`areElementsSame`) sees the edit.
   */
  emitChange(
    elements: ElementRecord[],
    appState?: Record<string, unknown>,
    files?: Record<string, unknown>,
  ): void {
    const prevById = new Map(this.elements.map((el) => [el.id as string, el]));
    this.elements = elements.map((el) => {
      const prev = prevById.get(el.id as string);
      const next = { ...el };
      if (!prev) {
        return next;
      }
      const {
        version: _pv,
        versionNonce: _pn,
        updated: _pu,
        ...prevRest
      } = prev;
      const {
        version: _nv,
        versionNonce: _nn,
        updated: _nu,
        ...nextRest
      } = next;
      if (JSON.stringify(prevRest) !== JSON.stringify(nextRest)) {
        next.version = ((prev.version as number) ?? 0) + 1;
        next.versionNonce = Math.floor(Math.random() * 2 ** 31);
        next.updated = Date.now();
      }
      return next;
    });
    if (appState) {
      this.appState = { ...this.appState, ...appState };
    }
    if (files) {
      this.files = { ...this.files, ...files };
    }
    for (const handler of this.changeHandlers) {
      handler(this.elements, this.appState, this.files ?? {});
    }
  }

  asBindingAPI(): BindingExcalidrawAPI {
    return this as unknown as BindingExcalidrawAPI;
  }

  /** The minimal `api` shape an `AwarenessRouter` expects. */
  routerApi(): AwarenessRouterApi {
    return {
      updateScene: this.updateScene,
      dispatchIncomingEmojiReaction: this.dispatchIncomingEmojiReaction,
      dispatchIncomingCountdownTimer: this.dispatchIncomingCountdownTimer,
    } as unknown as AwarenessRouterApi;
  }
}

type AwarenessRouterApi = ConstructorParameters<
  typeof AwarenessRouter
>[0]["api"];

let seq = 0;

/** Build a minimal valid rectangle element with sensible defaults. */
export const makeElement = (
  overrides: Partial<ElementRecord> & { id: string },
): ElementRecord => ({
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  seed: ++seq,
  version: 1,
  versionNonce: ++seq,
  updated: 1,
  index: null,
  isDeleted: false,
  groupIds: [],
  frameId: null,
  boundElements: null,
  roundness: null,
  link: null,
  locked: false,
  ...overrides,
});

/**
 * Exchange Yjs updates between two docs both ways until they converge (one round
 * is enough for these tests, but we do two to settle index-repair writes).
 */
export const sync = (a: Y.Doc, b: Y.Doc): void => {
  for (let round = 0; round < 3; round++) {
    const aState = Y.encodeStateAsUpdate(a);
    const bState = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(b, aState);
    Y.applyUpdate(a, bState);
  }
};

export { WhiteboardBinding, Y };
