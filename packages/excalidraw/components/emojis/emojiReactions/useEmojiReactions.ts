import { useState, useCallback, useRef, useEffect } from "react";

import {
  TOOL_TYPE,
  isTestEnv,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import type { AppClassProperties, UIAppState } from "../../../types";

export interface FloatingEmojiData {
  id: string;
  emoji: string;
  sceneX: number;
  sceneY: number;
}

export interface UseEmojiReactionsResult {
  // state
  floatingEmojis: readonly FloatingEmojiData[];
  reactionModeActive: boolean;
  reactionEmoji: string | null;
  showEmojiPicker: boolean;
  overlayDisabled: boolean;

  // refs
  emojiPickerRef: React.RefObject<HTMLDivElement | null>;
  lastToggleTimeRef: React.RefObject<number>;

  // actions
  toggleReactionMode: () => void;
  handleSelectReactionEmoji: (emoji: string) => void;
  removeFloatingEmoji: (id: string) => void;

  // overlay pointer handlers
  spawnEmoji: (clientX: number, clientY: number) => void;
  scheduleForwardPointerUpdate: (
    clientX: number,
    clientY: number,
    pointerId: number,
  ) => void;

  // overlay pointer state refs (for pointerdown handler)
  reactionCursorButtonRef: React.MutableRefObject<"up" | "down">;
  lastSpawnRef: React.MutableRefObject<number>;
}

export const useEmojiReactions = (
  app: AppClassProperties,
  appState: UIAppState,
  canvas: HTMLCanvasElement,
): UseEmojiReactionsResult => {
  // --- state ---
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmojiData[]>([]);
  const reactionModeActive =
    appState.activeTool.type === TOOL_TYPE.emojiReaction;
  const [reactionEmoji, setReactionEmoji] = useState<string | null>(null);
  const [overlayDisabled, setOverlayDisabled] = useState(false);

  // --- refs ---
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const lastSpawnRef = useRef<number>(0);
  const lastToggleTimeRef = useRef<number>(0);
  const toggleReactionModeRef = useRef<() => void>(() => {});
  const overlayDisableTimeoutRef = useRef<number | null>(null);

  // pointer-forwarding refs
  const reactionPointersMapRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  const reactionCursorButtonRef = useRef<"up" | "down">("up");
  const reactionRafRef = useRef<number | null>(null);
  const reactionPendingPointerRef = useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
  } | null>(null);

  // --- effects ---

  // Subscribe to incoming ephemeral UI events from collab
  useEffect(() => {
    const unsubEmoji = app.onIncomingEmojiReactionEmitter?.on((payload) => {
      setFloatingEmojis((prev) => [
        ...prev,
        {
          id: payload.id,
          emoji: payload.emoji,
          sceneX: payload.x,
          sceneY: payload.y,
        },
      ]);
    });

    return () => {
      unsubEmoji?.();
    };
  }, [app]);

  // keyboard shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement)
      ) {
        return;
      }
      if (e.key === "r" || e.key === "R") {
        toggleReactionModeRef.current();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // cleanup overlay disable timeout
  useEffect(() => {
    return () => {
      if (overlayDisableTimeoutRef.current) {
        window.clearTimeout(overlayDisableTimeoutRef.current);
        overlayDisableTimeoutRef.current = null;
      }
    };
  }, []);

  // close emoji picker on click outside
  useEffect(() => {
    if (!showEmojiPicker) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    };
    const id = window.setTimeout(
      () => window.addEventListener("pointerdown", onPointerDown),
      0,
    );
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showEmojiPicker]);

  // cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (reactionRafRef.current != null) {
        window.cancelAnimationFrame(reactionRafRef.current);
        reactionRafRef.current = null;
      }
    };
  }, []);

  // reset pointer state when reaction mode deactivates
  useEffect(() => {
    if (!reactionModeActive) {
      reactionCursorButtonRef.current = "up";
      reactionPointersMapRef.current.clear();
      reactionPendingPointerRef.current = null;
      if (reactionRafRef.current != null) {
        window.cancelAnimationFrame(reactionRafRef.current);
        reactionRafRef.current = null;
      }
    }
  }, [reactionModeActive]);

  // --- helpers ---

  const setOverlayDisableTimeout = () => {
    setOverlayDisabled(true);
    if (overlayDisableTimeoutRef.current) {
      window.clearTimeout(overlayDisableTimeoutRef.current);
    }
    overlayDisableTimeoutRef.current = window.setTimeout(() => {
      setOverlayDisabled(false);
      overlayDisableTimeoutRef.current = null;
    }, 35) as unknown as number;
  };

  const dismissCoachMark = () => {
    if (!isTestEnv()) {
      try {
        if (!localStorage.getItem("excalidraw.reactionModeCoachSeen")) {
          localStorage.setItem("excalidraw.reactionModeCoachSeen", "true");
        }
      } catch (err) {
        // ignore
      }
    }
  };

  // --- callbacks ---

  const spawnEmoji = useCallback(
    (clientX: number, clientY: number) => {
      if (!reactionEmoji) {
        return;
      }
      const id = Math.random().toString(36).slice(2);
      const emoji = reactionEmoji;

      const canvasRect = canvas?.getBoundingClientRect();
      const offsetLeft = canvasRect?.left ?? 0;
      const offsetTop = canvasRect?.top ?? 0;

      const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
        { clientX, clientY },
        {
          zoom: appState.zoom,
          offsetLeft,
          offsetTop,
          scrollX: app.state.scrollX,
          scrollY: app.state.scrollY,
        },
      );

      setFloatingEmojis((prev) => [...prev, { id, emoji, sceneX, sceneY }]);
      try {
        app.props.onRequestBroadcastEmojiReaction?.(emoji, sceneX, sceneY);
      } catch (e) {
        // ignore
      }
    },
    [reactionEmoji, app, appState.zoom, canvas],
  );

  const forwardPointerUpdate = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      if (!app.props.onPointerUpdate) {
        return;
      }

      const pointersMap = reactionPointersMapRef.current;
      const isDown = reactionCursorButtonRef.current === "down";
      if (isDown) {
        const existing = pointersMap.get(pointerId);
        if (existing) {
          existing.x = clientX;
          existing.y = clientY;
        } else {
          pointersMap.set(pointerId, { x: clientX, y: clientY });
        }
      } else {
        pointersMap.delete(pointerId);
      }

      const canvasRect = canvas?.getBoundingClientRect();
      const offsetLeft = canvasRect?.left ?? 0;
      const offsetTop = canvasRect?.top ?? 0;

      const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
        { clientX, clientY },
        {
          zoom: appState.zoom,
          offsetLeft,
          offsetTop,
          scrollX: app.state.scrollX,
          scrollY: app.state.scrollY,
        },
      );

      try {
        app.props.onPointerUpdate({
          pointer: {
            x: sceneX,
            y: sceneY,
            tool: app.state.activeTool.type === "laser" ? "laser" : "pointer",
          },
          button: reactionCursorButtonRef.current,
          pointersMap,
        });
      } catch (e) {
        console.warn("Failed to forward pointer update", e);
      }
    },
    [app, appState.zoom, canvas],
  );

  const scheduleForwardPointerUpdate = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      reactionPendingPointerRef.current = { clientX, clientY, pointerId };
      if (reactionRafRef.current != null) {
        return;
      }
      reactionRafRef.current = window.requestAnimationFrame(() => {
        reactionRafRef.current = null;
        const pending = reactionPendingPointerRef.current;
        if (!pending) {
          return;
        }
        forwardPointerUpdate(
          pending.clientX,
          pending.clientY,
          pending.pointerId,
        );
      });
    },
    [forwardPointerUpdate],
  );

  const toggleReactionMode = useCallback(() => {
    try {
      lastToggleTimeRef.current = performance.now();
    } catch (err) {
      // ignore
    }
    setOverlayDisableTimeout();

    // turn off
    if (reactionModeActive) {
      setReactionEmoji(null);
      setShowEmojiPicker(false);
      app.setActiveTool({ type: "selection" });
      return;
    }

    // turn on but no emoji selected -> open picker first
    if (!reactionEmoji) {
      setShowEmojiPicker(true);
      return;
    }

    // turn on with emoji selected
    dismissCoachMark();
    try {
      lastToggleTimeRef.current = performance.now();
    } catch (err) {
      // ignore
    }
    app.setActiveTool({ type: TOOL_TYPE.emojiReaction });
  }, [reactionModeActive, reactionEmoji, app]);

  // keep ref in sync so the keydown listener never goes stale
  useEffect(() => {
    toggleReactionModeRef.current = toggleReactionMode;
  }, [toggleReactionMode]);

  const handleSelectReactionEmoji = useCallback(
    (emoji: string) => {
      setReactionEmoji(emoji);
      setShowEmojiPicker(false);

      try {
        lastToggleTimeRef.current = performance.now();
      } catch (err) {
        // ignore
      }
      setOverlayDisableTimeout();
      dismissCoachMark();
      app.setActiveTool({ type: TOOL_TYPE.emojiReaction });
    },
    [app],
  );

  const removeFloatingEmoji = useCallback((id: string) => {
    setFloatingEmojis((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return {
    floatingEmojis,
    reactionModeActive,
    reactionEmoji,
    showEmojiPicker,
    overlayDisabled,
    emojiPickerRef,
    lastToggleTimeRef,
    toggleReactionMode,
    handleSelectReactionEmoji,
    removeFloatingEmoji,
    spawnEmoji,
    scheduleForwardPointerUpdate,
    reactionCursorButtonRef,
    lastSpawnRef,
  };
};
