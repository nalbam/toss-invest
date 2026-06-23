// Registers @testing-library/jest-dom matchers on Vitest's `expect`. Only the
// jsdom-environment render tests rely on these matchers; importing the module
// merely extends `expect` and is inert for the node-environment server tests.
import "@testing-library/jest-dom/vitest";

// jsdom (29) on newer Node runtimes does not expose `window.localStorage`
// (Node's own experimental localStorage is gated behind --localstorage-file,
// which jsdom does not provide), so render tests that persist UI state — collapse
// state, chart interval, selected holding — would crash. Provide a minimal
// in-memory Storage when one is absent. Node-env server tests skip this (no
// `window`); each jsdom test file gets a fresh store.
if (typeof window !== "undefined" && !window.localStorage) {
  const createStorage = (): Storage => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
    };
  };
  Object.defineProperty(window, "localStorage", {
    value: createStorage(),
    configurable: true,
    writable: true,
  });
}
