import { useState, useCallback, useRef, useEffect } from "react";

import type { AppClassProperties } from "../../types";

const STALE_TIMEOUT_MS = 10_000; // Evict remote timers that haven't sent an update in 10 seconds

export interface CountdownTimerEntry {
  startedBy: string;
  remainingSeconds: number;
  isOwner: boolean;
}

export interface UseCountdownTimerResult {
  /** Active timers from all users (including local). Keyed by startedBy. */
  timers: readonly CountdownTimerEntry[];
  /** True when at least one timer is active. */
  isActive: boolean;
  startTimer: (minutes: number, seconds: number) => void;
  cancelTimer: () => void;
}

export const useCountdownTimer = (
  app: AppClassProperties,
): UseCountdownTimerResult => {
  // Map keyed by startedBy → timer entry
  const [timersMap, setTimersMap] = useState<Map<string, CountdownTimerEntry>>(
    () => new Map(),
  );

  // For the local (owner) timer only
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef<number>(0);
  const ownerIdRef = useRef<string | null>(null);

  // Track last-seen timestamp for remote timers (stale eviction)
  const remoteLastSeenRef = useRef<Map<string, number>>(new Map());

  const clearLocalInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cancelTimer = useCallback(() => {
    const ownerId = ownerIdRef.current;
    if (!ownerId) {
      return;
    }
    clearLocalInterval();
    ownerIdRef.current = null;

    setTimersMap((prev) => {
      const next = new Map(prev);
      next.delete(ownerId);
      return next;
    });

    try {
      app.props.onRequestBroadcastCountdownTimer?.(0, ownerId, false);
    } catch (error: any) {
      console.error("Failed to broadcast countdown timer cancellation", error);
    }
  }, [clearLocalInterval, app]);

  const startTimer = useCallback(
    (minutes: number, seconds: number) => {
      const totalSeconds = minutes * 60 + seconds;
      if (totalSeconds <= 0) {
        return;
      }

      // If we already own a timer, clear it first (override)
      clearLocalInterval();

      const userId = app.id || "local";
      ownerIdRef.current = userId;
      remainingRef.current = totalSeconds;

      setTimersMap((prev) => {
        const next = new Map(prev);
        next.set(userId, {
          startedBy: userId,
          remainingSeconds: totalSeconds,
          isOwner: true,
        });
        return next;
      });

      // broadcast initial state
      try {
        app.props.onRequestBroadcastCountdownTimer?.(
          totalSeconds,
          userId,
          true,
        );
      } catch (error: any) {
        console.error("Failed to broadcast countdown timer start", error);
      }

      intervalRef.current = setInterval(() => {
        if (remainingRef.current > 0) {
          remainingRef.current -= 1;
        }
        const next = remainingRef.current;

        setTimersMap((prev) => {
          const map = new Map(prev);
          const entry = map.get(userId);
          if (entry) {
            map.set(userId, { ...entry, remainingSeconds: next });
          }
          return map;
        });

        try {
          app.props.onRequestBroadcastCountdownTimer?.(next, userId, true);
        } catch (error: any) {
          console.error("Failed to broadcast countdown timer tick", error);
        }
      }, 1000);
    },
    [clearLocalInterval, app],
  );

  // Subscribe to incoming countdown timer events from collab
  useEffect(() => {
    const unsubTimer = app.onIncomingCountdownTimerEmitter?.on((payload) => {
      const { startedBy, active, remainingSeconds } = payload;
      if (!startedBy) {
        return;
      }

      if (!active) {
        // Remote user cancelled their timer — remove it
        remoteLastSeenRef.current.delete(startedBy);
        setTimersMap((prev) => {
          const next = new Map(prev);
          next.delete(startedBy);
          return next;
        });
        return;
      }

      // Remote update — upsert the entry (never mark as owner)
      remoteLastSeenRef.current.set(startedBy, Date.now());
      setTimersMap((prev) => {
        const next = new Map(prev);
        next.set(startedBy, {
          startedBy,
          remainingSeconds,
          isOwner: false,
        });
        return next;
      });
    });

    return () => {
      unsubTimer?.();
    };
  }, [app]);

  // Evict remote timers that haven't sent an update in 10 seconds
  useEffect(() => {
    const evictionInterval = setInterval(() => {
      const now = Date.now();
      const lastSeen = remoteLastSeenRef.current;
      const staleIds: string[] = [];

      lastSeen.forEach((ts, id) => {
        if (now - ts > STALE_TIMEOUT_MS) {
          staleIds.push(id);
        }
      });

      if (staleIds.length > 0) {
        for (const id of staleIds) {
          lastSeen.delete(id);
        }
        setTimersMap((prev) => {
          const next = new Map(prev);
          for (const id of staleIds) {
            // only remove if it's still a remote timer (not our own)
            const entry = next.get(id);
            if (entry && !entry.isOwner) {
              next.delete(id);
            }
          }
          return next;
        });
      }
    }, 3000);

    return () => {
      clearInterval(evictionInterval);
    };
  }, []);

  // Cleanup local interval on unmount
  useEffect(() => {
    return () => {
      clearLocalInterval();
    };
  }, [clearLocalInterval]);

  const timers = Array.from(timersMap.values());

  return {
    timers,
    isActive: timers.length > 0,
    startTimer,
    cancelTimer,
  };
};
