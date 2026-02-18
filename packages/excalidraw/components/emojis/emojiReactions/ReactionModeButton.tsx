import clsx from "clsx";

import "../../ToolIcon.scss";

import { reactionToolIcon } from "../../icons";

import type { ToolButtonSize } from "../../ToolButton";

type ReactionModeButtonProps = {
  title?: string;
  name?: string;
  checked: boolean;
  onChange?(): void;
  isMobile?: boolean;
  activeEmoji?: string | null;
};

const DEFAULT_SIZE: ToolButtonSize = "small";

export const ReactionModeButton = (props: ReactionModeButtonProps) => {
  return (
    <label
      className={clsx(
        "ToolIcon ToolIcon__ReactionMode",
        `ToolIcon_size_${DEFAULT_SIZE}`,
        {
          "is-mobile": props.isMobile,
        },
      )}
      title={props.title}
    >
      <input
        className="ToolIcon_type_checkbox"
        type="checkbox"
        name={props.name}
        onChange={props.onChange}
        checked={props.checked}
        aria-label={props.title}
        data-testid="toolbar-ReactionMode"
      />
      <div className="ToolIcon__icon">
        {props.activeEmoji ? (
          <span style={{ fontSize: "1.25em", lineHeight: 1 }}>
            {props.activeEmoji}
          </span>
        ) : (
          reactionToolIcon
        )}
      </div>
    </label>
  );
};
