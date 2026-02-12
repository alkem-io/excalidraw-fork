import { useState, useRef, useLayoutEffect, useCallback } from "react";

import { t } from "../../i18n";

import { reactionToolIcon } from "../icons";

import { EmojiPickerPanel } from "./EmojiPickerPanel";

import "../EmojiPicker.scss";

const ReactionEmojiSubmenu = ({
  onSelect,
}: {
  onSelect: (emoji: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
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

  return (
    <div className="emoji-submenu" data-testid="toolbar-reactions">
      <button
        ref={triggerRef}
        className="emoji-submenu__trigger dropdown-menu-item dropdown-menu-item-base"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="dropdown-menu-item__icon">{reactionToolIcon}</div>
        <div className="dropdown-menu-item__text">
          {t("toolBar.emojiReactions")}
        </div>
        <span className="emoji-submenu__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {isOpen && (
        <div ref={panelRef} className="emoji-submenu__panel">
          <EmojiPickerPanel
            onSelect={(emoji) => {
              setIsOpen(false);
              onSelect(emoji);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ReactionEmojiSubmenu;
