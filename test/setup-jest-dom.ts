// Registers @testing-library/jest-dom matchers on Vitest's `expect`. Only the
// jsdom-environment render tests rely on these matchers; importing the module
// merely extends `expect` and is inert for the node-environment server tests.
import "@testing-library/jest-dom/vitest";
