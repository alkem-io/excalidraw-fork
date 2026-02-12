import { useState, useRef, useLayoutEffect, useCallback } from "react";

import { t } from "../../i18n";

import { countdownTimerIcon } from "../icons";

import "./CountdownTimer.scss";

const CountdownTimerSubmenu = ({
  onStart,
}: {
  onStart: (minutes: number, seconds: number) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
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
    <div className="emoji-submenu" data-testid="toolbar-countdown-timer">
      <button
        ref={triggerRef}
        className="emoji-submenu__trigger dropdown-menu-item dropdown-menu-item-base"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="dropdown-menu-item__icon">{countdownTimerIcon}</div>
        <div className="dropdown-menu-item__text">
          {t("toolBar.countdownTimer")}
        </div>
        <span className="emoji-submenu__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {isOpen && (
        <div ref={panelRef} className="emoji-submenu__panel">
          <div className="countdown-timer-submenu">
            <div className="countdown-timer-submenu__title">
              {t("toolBar.countdownTimerSet")}
            </div>
            <div className="countdown-timer-submenu__inputs">
              <label className="countdown-timer-submenu__field">
                <span>{t("toolBar.countdownTimerMinutes")}</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={minutes}
                  onChange={(e) =>
                    setMinutes(
                      Math.max(0, Math.min(99, Number(e.target.value) || 0)),
                    )
                  }
                />
              </label>
              <label className="countdown-timer-submenu__field">
                <span>{t("toolBar.countdownTimerSeconds")}</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={seconds}
                  onChange={(e) =>
                    setSeconds(
                      Math.max(0, Math.min(59, Number(e.target.value) || 0)),
                    )
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="countdown-timer-submenu__start"
              onClick={() => {
                if (minutes > 0 || seconds > 0) {
                  setIsOpen(false);
                  onStart(minutes, seconds);
                }
              }}
            >
              {t("toolBar.countdownTimerStart")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CountdownTimerSubmenu;
