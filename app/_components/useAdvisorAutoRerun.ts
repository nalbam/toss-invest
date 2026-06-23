"use client";

import { useEffect, useRef, useState } from "react";
import {
  ADVISOR_AUTO_INTERVALS,
  type AdvisorAutoInterval,
} from "./AdvisorAutoControls";
import { readStoredJson, writeStoredJson } from "./localStorageJson";

interface AdvisorAutoSettings {
  enabled: boolean;
  intervalMs: AdvisorAutoInterval;
}

function isAdvisorAutoInterval(value: unknown): value is AdvisorAutoInterval {
  return ADVISOR_AUTO_INTERVALS.some((item) => item.value === value);
}

function isAdvisorAutoSettings(value: unknown): value is AdvisorAutoSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const settings = value as Partial<AdvisorAutoSettings>;
  return (
    typeof settings.enabled === "boolean" &&
    isAdvisorAutoInterval(settings.intervalMs)
  );
}

export function useAdvisorAutoRerun(
  run: () => void | Promise<void>,
  storageKey: string,
) {
  const runRef = useRef(run);
  const inFlightRef = useRef(false);
  const [settings, setSettings] = useState<AdvisorAutoSettings>({
    enabled: false,
    intervalMs: 600_000,
  });
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    const stored = readStoredJson(storageKey, isAdvisorAutoSettings);
    if (stored !== null) {
      setSettings(stored);
    }
  }, [storageKey]);

  function setAutoEnabled(enabled: boolean) {
    setSettings((current) => {
      const next = { ...current, enabled };
      writeStoredJson(storageKey, next);
      return next;
    });
  }

  function setAutoIntervalMs(intervalMs: AdvisorAutoInterval) {
    setSettings((current) => {
      const next = { ...current, intervalMs };
      writeStoredJson(storageKey, next);
      return next;
    });
  }

  useEffect(() => {
    if (!settings.enabled) {
      setRemainingMs(0);
      return;
    }
    // Skip a scheduled run while the previous one is still in flight to avoid
    // overlapping advisor requests and out-of-order UI updates.
    const runSafely = async () => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        await runRef.current();
      } finally {
        inFlightRef.current = false;
      }
    };
    let nextRunAt = Date.now() + settings.intervalMs;
    setRemainingMs(settings.intervalMs);
    const tickerId = window.setInterval(() => {
      setRemainingMs(Math.max(0, nextRunAt - Date.now()));
    }, 1_000);
    const runId = window.setInterval(() => {
      nextRunAt = Date.now() + settings.intervalMs;
      setRemainingMs(settings.intervalMs);
      void runSafely();
    }, settings.intervalMs);
    return () => {
      window.clearInterval(tickerId);
      window.clearInterval(runId);
    };
  }, [settings.enabled, settings.intervalMs]);

  return {
    autoEnabled: settings.enabled,
    autoIntervalMs: settings.intervalMs,
    autoRemainingRatio:
      settings.enabled && settings.intervalMs > 0
        ? remainingMs / settings.intervalMs
        : 0,
    setAutoEnabled,
    setAutoIntervalMs,
  };
}
