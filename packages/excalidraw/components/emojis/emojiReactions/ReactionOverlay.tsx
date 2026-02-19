import React, { useCallback, useEffect, useRef, useState } from "react";

import type { UseEmojiReactionsResult } from "./useEmojiReactions";

interface ReactionOverlayProps {
  overlayDisabled: boolean;
  lastToggleTimeRef: React.RefObject<number>;
  reactionCursorButtonRef: React.MutableRefObject<"up" | "down">;
  lastSpawnRef: React.MutableRefObject<number>;
  spawnEmoji: UseEmojiReactionsResult["spawnEmoji"];
  scheduleForwardPointerUpdate: UseEmojiReactionsResult["scheduleForwardPointerUpdate"];
}

export const ReactionOverlay: React.FC<ReactionOverlayProps> = ({
  overlayDisabled,
  lastToggleTimeRef,
  reactionCursorButtonRef,
  lastSpawnRef,
  spawnEmoji,
  scheduleForwardPointerUpdate,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Track space key for space+drag panning pass-through
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        spaceHeldRef.current = true;
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const forwardEventToCanvas = useCallback(
    (e: React.PointerEvent) => {
      const overlay = overlayRef.current;
      if (!overlay) {
        return;
      }
      // Temporarily disable pointer-events so elementFromPoint finds canvas
      overlay.style.pointerEvents = "none";
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target) {
        target.dispatchEvent(new PointerEvent("pointerdown", e.nativeEvent));
      }
      // Re-enable after panning ends
      const reEnable = () => {
        if (overlay) {
          overlay.style.pointerEvents =
            overlayDisabled || spaceHeldRef.current ? "none" : "auto";
        }
        window.removeEventListener("pointerup", reEnable);
      };
      window.addEventListener("pointerup", reEnable);
    },
    [overlayDisabled],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Forward non-left-click (e.g. middle-click pan) to canvas
      if (e.button !== 0) {
        forwardEventToCanvas(e);
        return;
      }

      // Forward space+drag to canvas for panning
      if (spaceHeldRef.current) {
        forwardEventToCanvas(e);
        return;
      }

      // ignore immediate pointerdown that comes from toggling via toolbar button
      try {
        const now = performance.now();
        if (now - (lastToggleTimeRef.current || 0) < 20) {
          return;
        }
      } catch (err) {
        // ignore
      }

      reactionCursorButtonRef.current = "down";
      scheduleForwardPointerUpdate(e.clientX, e.clientY, e.pointerId);

      e.stopPropagation();
      spawnEmoji(e.clientX, e.clientY);
      lastSpawnRef.current = performance.now();

      const move = (ev: PointerEvent) => {
        const now = performance.now();
        if (now - lastSpawnRef.current > 90) {
          spawnEmoji(ev.clientX, ev.clientY);
          lastSpawnRef.current = now;
        }
        scheduleForwardPointerUpdate(ev.clientX, ev.clientY, ev.pointerId);
      };

      const up = (ev: PointerEvent) => {
        reactionCursorButtonRef.current = "up";
        scheduleForwardPointerUpdate(ev.clientX, ev.clientY, ev.pointerId);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [
      forwardEventToCanvas,
      lastToggleTimeRef,
      reactionCursorButtonRef,
      lastSpawnRef,
      spawnEmoji,
      scheduleForwardPointerUpdate,
    ],
  );

  // When space is held or overlay is disabled, pointer-events: none
  // allows all events to pass through to canvas for pan/zoom
  const effectivePointerEvents = overlayDisabled || spaceHeld ? "none" : "auto";

  return (
    <div
      ref={overlayRef}
      className="reaction-overlay"
      style={{
        position: "absolute",
        inset: 0,
        cursor: "pointer",
        pointerEvents: effectivePointerEvents,
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 3,
      }}
      onPointerMove={(e) => {
        scheduleForwardPointerUpdate(e.clientX, e.clientY, e.pointerId);
      }}
      onPointerDown={onPointerDown}
    />
  );
};

ReactionOverlay.displayName = "ReactionOverlay";
