import {
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  useEffect,
} from "react";

import { t } from "../../i18n";

import { countdownTimerIcon } from "../icons";

import "./CountdownTimer.scss";

const CountdownTimerSubmenu = ({
  onStart,
  isOpen,
  onToggle,
}: {
  onStart: (minutes: number, seconds: number) => void;
  isOpen: boolean;
  onToggle: () => void;
}) => {
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
        onToggle();
      }
    };
    document.addEventListener("pointerdown", handleClickOutside);
    return () =>
      document.removeEventListener("pointerdown", handleClickOutside);
  }, [isOpen, onToggle]);

  return (
    <div className="emoji-submenu" data-testid="toolbar-countdown-timer">
      <button
        ref={triggerRef}
        className="emoji-submenu__trigger dropdown-menu-item dropdown-menu-item-base"
        type="button"
        onClick={onToggle}
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
                  if (isOpen) {
                    onToggle();
                  }
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
