import React from "react";

const EMOJIS = ["👍", "👏", "😂", "❤️", "🎉", "🔥", "😮", "😢", "👀", "💯"];

export const EmojiPickerPanel: React.FC<{
  onSelect: (emoji: string) => void;
}> = ({ onSelect }) => (
  <div className="emoji-submenu__grid">
    {EMOJIS.map((emoji) => (
      <button
        key={emoji}
        type="button"
        className="emoji-submenu__emoji"
        onClick={() => {
          onSelect(emoji);
        }}
      >
        {emoji}
      </button>
    ))}
  </div>
);

EmojiPickerPanel.displayName = "EmojiPickerPanel";
