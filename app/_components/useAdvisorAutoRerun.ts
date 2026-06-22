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
  const [settings, setSettings] = useState<AdvisorAutoSettings>({
    enabled: false,
    intervalMs: 600_000,
  });

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
      return;
    }
    const id = window.setInterval(() => {
      void runRef.current();
    }, settings.intervalMs);
    return () => window.clearInterval(id);
  }, [settings.enabled, settings.intervalMs]);

  return {
    autoEnabled: settings.enabled,
    autoIntervalMs: settings.intervalMs,
    setAutoEnabled,
    setAutoIntervalMs,
  };
}
