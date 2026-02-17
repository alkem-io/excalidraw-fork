import React from "react";

import { CloseIcon } from "../icons";

import "./CountdownTimer.scss";

import type { CountdownTimerEntry } from "./useCountdownTimer";

const formatTime = (totalSeconds: number): string => {
  const clamped = Math.floor(Math.max(0, totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export const CountdownTimerPanel: React.FC<{
  timers: readonly CountdownTimerEntry[];
  onCancel: () => void;
}> = ({ timers, onCancel }) => {
  if (timers.length === 0) {
    return null;
  }

  return (
    <div className="countdown-timer-panel">
      {timers.map((timer) => {
        const warning =
          timer.remainingSeconds <= 60 && timer.remainingSeconds > 5;
        const critical = timer.remainingSeconds <= 5;

        return (
          <div
            key={timer.startedBy}
            className={`countdown-timer-row${
              warning ? " countdown-timer-row--warning" : ""
            }${critical ? " countdown-timer-row--critical" : ""}`}
          >
            <span className="countdown-timer-row__time">
              {formatTime(timer.remainingSeconds)}
            </span>
            {timer.isOwner && (
              <button
                type="button"
                className="countdown-timer-row__cancel"
                onClick={onCancel}
                aria-label="Cancel timer"
              >
                {CloseIcon}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

CountdownTimerPanel.displayName = "CountdownTimerPanel";
