import { getStoredItem, setStoredItem } from "./settingsStore";

export function readStoredJson<T>(
  storageKey: string,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const stored = getStoredItem(storageKey);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredJson(storageKey: string, value: unknown): void {
  try {
    setStoredItem(storageKey, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}
