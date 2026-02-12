import React, { useCallback } from "react";

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
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // ignore immediate pointerdown that comes from toggling via toolbar button
      try {
        const now = performance.now();
        if (now - (lastToggleTimeRef.current || 0) < 300) {
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
      lastToggleTimeRef,
      reactionCursorButtonRef,
      lastSpawnRef,
      spawnEmoji,
      scheduleForwardPointerUpdate,
    ],
  );

  return (
    <div
      className="reaction-overlay"
      style={{
        position: "absolute",
        inset: 0,
        cursor: "pointer",
        zIndex: -1,
        pointerEvents: overlayDisabled ? "none" : "auto",
      }}
      onPointerMove={(e) => {
        scheduleForwardPointerUpdate(e.clientX, e.clientY, e.pointerId);
      }}
      onPointerDown={onPointerDown}
    />
  );
};

ReactionOverlay.displayName = "ReactionOverlay";
