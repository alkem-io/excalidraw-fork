import { useRef, useLayoutEffect, useCallback } from "react";

import { t } from "../../../i18n";

import { reactionToolIcon } from "../../icons";

import "../insertEmoji/EmojiPicker.scss";

import { EmojiPickerPanel } from "./EmojiPickerPanel";

const ReactionEmojiSubmenu = ({
  onSelect,
  isOpen,
  onToggle,
}: {
  onSelect: (emoji: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}) => {
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

  return (
    <div className="emoji-submenu" data-testid="toolbar-reactions">
      <button
        ref={triggerRef}
        className="emoji-submenu__trigger dropdown-menu-item dropdown-menu-item-base"
        type="button"
        onClick={onToggle}
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
              if (isOpen) {
                onToggle();
              }
              onSelect(emoji);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ReactionEmojiSubmenu;
