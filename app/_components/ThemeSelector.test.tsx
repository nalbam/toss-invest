// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeSelector } from "./ThemeSelector";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  window.localStorage.clear();
});

describe("ThemeSelector", () => {
  it("defaults to system theme", () => {
    render(<ThemeSelector />);

    expect(screen.getByRole("group", { name: "테마" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "시스템" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("stores and applies the selected theme", () => {
    render(<ThemeSelector />);

    fireEvent.click(screen.getByRole("button", { name: "다크" }));

    expect(window.localStorage.getItem("toss-invest:theme")).toBe('"dark"');
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("restores a stored theme", async () => {
    window.localStorage.setItem("toss-invest:theme", JSON.stringify("light"));

    render(<ThemeSelector />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "라이트" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
