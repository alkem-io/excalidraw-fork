import {
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  useEffect,
} from "react";

import { convertToExcalidrawElements } from "../data/transform";
import { t } from "../i18n";

import { useApp } from "./App";
import { EmojiIcon } from "./icons";
import { defaultInsertEmojiConfig } from "./emojis/insertEmoji/insertEmojiConfig";

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
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;

    // keep panel within viewport horizontally
    let left = rect.right + 4;
    if (left + panelWidth > window.innerWidth) {
      left = rect.left - panelWidth - 4;
    }
    // keep panel within viewport vertically
    let top = rect.top;
    if (top + panelHeight > window.innerHeight) {
      top = window.innerHeight - panelHeight - 4;
    }

    panel.style.left = `${Math.max(4, left)}px`;
    panel.style.top = `${Math.max(4, top)}px`;
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePanelPosition();
    }
  }, [isOpen, updatePanelPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClickOutside);
    return () =>
      document.removeEventListener("pointerdown", handleClickOutside);
  }, [isOpen]);

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
        <div className="dropdown-menu-item__text">
          {t("toolBar.insertEmoji")}
        </div>
        <span className="emoji-submenu__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {isOpen && (
        <div ref={panelRef} className="emoji-submenu__panel">
          <div className="emoji-submenu__grid">
            {defaultInsertEmojiConfig.emojis.map((entry) => (
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
