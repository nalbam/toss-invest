"use client";

import { useEffect, useState } from "react";
import { readStoredJson, writeStoredJson } from "./localStorageJson";
import page from "@/app/page.module.css";

type ThemePreference = "system" | "light" | "dark";

const THEME_KEY = "toss-invest:theme";
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "시스템" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
    root.style.colorScheme = "";
    return;
  }
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function ThemeSelector() {
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = readStoredJson(THEME_KEY, isThemePreference);
    const next = stored ?? "system";
    setTheme(next);
    applyTheme(next);
  }, []);

  function changeTheme(next: ThemePreference) {
    setTheme(next);
    writeStoredJson(THEME_KEY, next);
    applyTheme(next);
  }

  return (
    <fieldset className={`${page.controls} ${page.themeControl}`}>
      <div className={page.themeSegmented}>
        {THEME_OPTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={page.themeButton}
            aria-label={item.label}
            aria-pressed={theme === item.value}
            title={item.label}
            onClick={() => changeTheme(item.value)}
          >
            <ThemeIcon theme={item.value} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  if (theme === "light") {
    return (
      <svg className={page.themeIcon} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg className={page.themeIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.79A8.5 8.5 0 1 1 11.21 3 6.5 6.5 0 0 0 21 12.79Z" />
      </svg>
    );
  }
  return (
    <svg className={page.themeIcon} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
