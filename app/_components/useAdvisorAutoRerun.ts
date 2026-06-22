"use client";

import { useEffect, useRef, useState } from "react";
import type { AdvisorAutoInterval } from "./AdvisorAutoControls";

export function useAdvisorAutoRerun(run: () => void | Promise<void>) {
  const runRef = useRef(run);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoIntervalMs, setAutoIntervalMs] =
    useState<AdvisorAutoInterval>(60_000);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (!autoEnabled) {
      return;
    }
    const id = window.setInterval(() => {
      void runRef.current();
    }, autoIntervalMs);
    return () => window.clearInterval(id);
  }, [autoEnabled, autoIntervalMs]);

  return {
    autoEnabled,
    autoIntervalMs,
    setAutoEnabled,
    setAutoIntervalMs,
  };
}
