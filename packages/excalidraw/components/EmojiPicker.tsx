import { useState, useRef, useLayoutEffect, useCallback } from "react";

import { convertToExcalidrawElements } from "../data/transform";
import { t } from "../i18n";

import { useApp } from "./App";
import { EmojiIcon } from "./icons";
import { defaultEmojiReactionConfig } from "./emojis/reactionEmoji/emojiReactionConfig";

import "./EmojiPicker.scss";

const EMOJI_FONT_SIZE = 48;

const EmojiPicker = ({ onInsert }: { onInsert: () => void }) => {
  const app = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    let top = rect.top;
    const panelHeight = panel.offsetHeight;
    // keep panel within viewport vertically
    if (top + panelHeight > window.innerHeight) {
      top = window.innerHeight - panelHeight - 4;
    }
    panel.style.left = `${rect.right + 4}px`;
    panel.style.top = `${Math.max(4, top)}px`;
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePanelPosition();
    }
  }, [isOpen, updatePanelPosition]);

  const handleInsertEmoji = (emoji: string) => {
    const elements = convertToExcalidrawElements([
      { type: "text", text: emoji, x: 0, y: 0, fontSize: EMOJI_FONT_SIZE },
    ]);
    app.onInsertElements(elements);
    setIsOpen(false);
    onInsert();
  };

  return (
    <div
      ref={containerRef}
      className="emoji-submenu"
      data-testid="toolbar-emoji"
    >
      <button
        ref={triggerRef}
        className="emoji-submenu__trigger dropdown-menu-item dropdown-menu-item-base"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="dropdown-menu-item__icon">{EmojiIcon}</div>
        <div className="dropdown-menu-item__text">{t("toolBar.emoji")}</div>
        <span className="emoji-submenu__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {isOpen && (
        <div ref={panelRef} className="emoji-submenu__panel">
          <div className="emoji-submenu__grid">
            {defaultEmojiReactionConfig.emojis.map((entry) => (
              <button
                key={entry.emoji}
                className="emoji-submenu__emoji"
                onClick={() => handleInsertEmoji(entry.emoji)}
                title={entry.label}
                aria-label={entry.label}
                type="button"
              >
                {entry.emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmojiPicker;
