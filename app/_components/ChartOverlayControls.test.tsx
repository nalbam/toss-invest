// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChartOverlayControls } from "./ChartOverlayControls";

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof ChartOverlayControls>[0]> = {}) {
  const props = {
    showLabels: true,
    showLines: true,
    showAdvice: true,
    onToggleLabels: vi.fn(),
    onToggleLines: vi.fn(),
    onToggleAdvice: vi.fn(),
    ...overrides,
  };
  render(<ChartOverlayControls {...props} />);
  return props;
}

describe("ChartOverlayControls", () => {
  it("reflects each toggle's pressed state from props", () => {
    setup({ showLabels: true, showLines: false, showAdvice: true });
    expect(screen.getByLabelText("지지/저항 라벨 표시")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("지지/저항 선 표시")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("AI 조언 세로선 표시")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls the matching handler on click", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText("지지/저항 라벨 표시"));
    fireEvent.click(screen.getByLabelText("지지/저항 선 표시"));
    fireEvent.click(screen.getByLabelText("AI 조언 세로선 표시"));
    expect(props.onToggleLabels).toHaveBeenCalledTimes(1);
    expect(props.onToggleLines).toHaveBeenCalledTimes(1);
    expect(props.onToggleAdvice).toHaveBeenCalledTimes(1);
  });
});
