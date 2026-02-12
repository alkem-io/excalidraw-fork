import React from "react";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import { FloatingEmoji } from "./FloatingEmoji";

import type { AppClassProperties, UIAppState } from "../../types";

import type { FloatingEmojiData } from "./useEmojiReactions";

interface FloatingEmojisLayerProps {
  floatingEmojis: readonly FloatingEmojiData[];
  zoom: UIAppState["zoom"];
  canvasOffsetLeft: number;
  canvasOffsetTop: number;
  scrollX: AppClassProperties["state"]["scrollX"];
  scrollY: AppClassProperties["state"]["scrollY"];
  onRemove: (id: string) => void;
}

export const FloatingEmojisLayer: React.FC<FloatingEmojisLayerProps> = ({
  floatingEmojis,
  zoom,
  canvasOffsetLeft,
  canvasOffsetTop,
  scrollX,
  scrollY,
  onRemove,
}) => {
  return (
    <>
      {floatingEmojis.map((e) => {
        const { x, y } = sceneCoordsToViewportCoords(
          { sceneX: e.sceneX, sceneY: e.sceneY },
          {
            zoom,
            offsetLeft: canvasOffsetLeft,
            offsetTop: canvasOffsetTop,
            scrollX,
            scrollY,
          },
        );

        return (
          <FloatingEmoji
            key={e.id}
            emoji={e.emoji}
            x={x}
            y={y}
            onDone={() => onRemove(e.id)}
          />
        );
      })}
    </>
  );
};

FloatingEmojisLayer.displayName = "FloatingEmojisLayer";
