import type {
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";

import type { Awareness } from "y-protocols/awareness";

/**
 * Ephemeral state routing (data-model §7, FR-B-008). Cursors, selection,
 * idle/mode go to y-protocols **awareness**; emoji reactions, the countdown
 * timer, and visible-scene-bounds go to the **ephemeral** event channel. NONE
 * of this is ever written to the scene `Y.Doc` — putting presence in the doc
 * would persist transient state and corrupt the merge/diff model.
 *
 * The ephemeral event channel is transport-agnostic here: it is modelled as a
 * pluggable `send`/`receive` pair so WS-D can wire it to the `2` Ephemeral WS
 * message type without this package knowing about sockets.
 */

export type PointerPayload = {
  pointer: { x: number; y: number; tool?: "pointer" | "laser" } | null;
  button: "up" | "down";
  pointersMap?: Map<number, { x: number; y: number }>;
};

export type EmojiReactionPayload = {
  id: string;
  emoji: string;
  x: number;
  y: number;
};

export type CountdownTimerPayload = {
  remainingSeconds: number;
  startedBy: string;
  active: boolean;
};

export type VisibleSceneBoundsPayload = {
  sceneBounds: [number, number, number, number];
};

/** Ephemeral event kinds carried out-of-band (never in the scene doc). */
export type EphemeralEvent =
  | { type: "EMOJI_REACTION"; payload: EmojiReactionPayload }
  | { type: "COUNTDOWN_TIMER"; payload: CountdownTimerPayload }
  | { type: "USER_VISIBLE_SCENE_BOUNDS"; payload: VisibleSceneBoundsPayload };

/** Transport seam for the ephemeral channel (WS-D plugs the real one in). */
export type EphemeralChannel = {
  send: (event: EphemeralEvent) => void;
  subscribe: (handler: (event: EphemeralEvent) => void) => () => void;
};

export type AwarenessRouterDeps = {
  awareness: Awareness;
  api: Pick<
    ExcalidrawImperativeAPI,
    | "updateScene"
    | "dispatchIncomingEmojiReaction"
    | "dispatchIncomingCountdownTimer"
  >;
  ephemeral?: EphemeralChannel;
};

/**
 * Routes ephemeral state to/from awareness + the ephemeral channel, keeping the
 * scene `Y.Doc` byte-untouched (US4 / SC-B-004).
 */
export class AwarenessRouter {
  private readonly awareness: Awareness;
  private readonly api: AwarenessRouterDeps["api"];
  private readonly ephemeral?: EphemeralChannel;
  private readonly cleanups: Array<() => void> = [];

  constructor(deps: AwarenessRouterDeps) {
    this.awareness = deps.awareness;
    this.api = deps.api;
    this.ephemeral = deps.ephemeral;

    // Remote awareness → collaborator cursors (touches no elements). The
    // y-protocols 'change' event passes an origin; LOCAL-origin changes (our own
    // cursor/selection moves via setLocalStateField) must NOT trigger an
    // applyRemoteAwareness → updateScene → onChange cycle — only remote peers'
    // state does (Fix #7).
    const onChange = (
      _changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "local") {
        return;
      }
      this.applyRemoteAwareness();
    };
    this.awareness.on("change", onChange);
    this.cleanups.push(() => this.awareness.off("change", onChange));

    // Incoming ephemeral events → imperative dispatch.
    if (this.ephemeral) {
      const unsub = this.ephemeral.subscribe((event) =>
        this.dispatchIncoming(event),
      );
      this.cleanups.push(unsub);
    }
  }

  /** Local pointer move → awareness (FR-B-008). Never the scene doc. */
  onPointerUpdate(payload: PointerPayload): void {
    this.awareness.setLocalStateField("pointer", payload.pointer);
    this.awareness.setLocalStateField("button", payload.button);
  }

  /** Local selection highlight → awareness. */
  onSelectionChange(selectedElementIds: Record<string, true>): void {
    this.awareness.setLocalStateField("selectedElementIds", selectedElementIds);
  }

  /** Local idle status → awareness. */
  onIdleChange(userState: string): void {
    this.awareness.setLocalStateField("userState", userState);
  }

  /** Local user identity → awareness. */
  setUser(user: Record<string, unknown>): void {
    this.awareness.setLocalStateField("user", user);
  }

  /** Local emoji reaction → ephemeral channel (never the scene doc). */
  broadcastEmojiReaction(payload: EmojiReactionPayload): void {
    this.ephemeral?.send({ type: "EMOJI_REACTION", payload });
  }

  /** Local countdown timer → ephemeral channel. */
  broadcastCountdownTimer(payload: CountdownTimerPayload): void {
    this.ephemeral?.send({ type: "COUNTDOWN_TIMER", payload });
  }

  /** Local visible-scene-bounds (follow mode) → ephemeral channel. */
  broadcastVisibleSceneBounds(payload: VisibleSceneBoundsPayload): void {
    this.ephemeral?.send({ type: "USER_VISIBLE_SCENE_BOUNDS", payload });
  }

  /** Dispatch an incoming ephemeral event to the editor. */
  private dispatchIncoming(event: EphemeralEvent): void {
    switch (event.type) {
      case "EMOJI_REACTION":
        this.api.dispatchIncomingEmojiReaction(event.payload);
        break;
      case "COUNTDOWN_TIMER":
        this.api.dispatchIncomingCountdownTimer(event.payload);
        break;
      case "USER_VISIBLE_SCENE_BOUNDS":
        // follow-mode bounds are consumed by the host (WS-D); no-op here.
        break;
      default:
        break;
    }
  }

  /** Map remote awareness states → collaborators and apply via updateScene. */
  private applyRemoteAwareness(): void {
    const collaborators = new Map<SocketId, Collaborator>();
    const states = this.awareness.getStates();
    for (const [clientId, state] of states) {
      if (clientId === this.awareness.clientID) {
        continue; // skip self
      }
      const socketId = String(clientId) as SocketId;
      collaborators.set(socketId, {
        pointer: state.pointer ?? undefined,
        button: state.button ?? undefined,
        selectedElementIds: state.selectedElementIds ?? undefined,
        userState: state.userState ?? undefined,
        username: state.user?.username ?? undefined,
        avatarUrl: state.user?.avatarUrl ?? undefined,
        color: state.user?.color ?? undefined,
        id: state.user?.id ?? undefined,
        socketId,
      });
    }
    this.api.updateScene({ collaborators });
  }

  destroy(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups.length = 0;
    // Clear our local presence on teardown so peers drop this client's cursor
    // immediately instead of waiting ~30s for the awareness timeout to expire
    // (Fix #7 — no ghost cursor after unmount). This emits a 'removed' change to
    // other clients; our own handler is already detached above.
    try {
      this.awareness.setLocalState(null);
    } catch {
      // awareness may already be destroyed (e.g. its doc was destroyed first)
    }
  }
}
