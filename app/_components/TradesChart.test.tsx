// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Trade } from "@/lib/client/types";

const setData = vi.fn();
const fitContent = vi.fn();
const addSeries = vi.fn(() => ({ setData }));
const remove = vi.fn();
const createChart = vi.fn(() => ({
  addSeries,
  timeScale: () => ({ fitContent }),
  remove,
}));

vi.mock("lightweight-charts", () => ({
  createChart,
  LineSeries: "LineSeries",
}));

const { TradesChart, toTradeSeries } = await import("./TradesChart");

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    price: "190.5",
    volume: "10",
    timestamp: "1700000100",
    currency: "USD",
    ...overrides,
  };
}

describe("toTradeSeries", () => {
  it("converts trades to a sorted price line keyed by second", () => {
    const series = toTradeSeries([
      trade({ timestamp: "1700000200", price: "191" }),
      trade({ timestamp: "1700000100", price: "190" }),
    ]);
    expect(series).toEqual([
      { time: 1700000100, value: 190 },
      { time: 1700000200, value: 191 },
    ]);
  });

  it("buckets trades in the same second (last wins) and drops bad rows", () => {
    const series = toTradeSeries([
      trade({ timestamp: "1700000100", price: "190" }),
      trade({ timestamp: "1700000100", price: "195" }),
      trade({ timestamp: "not-a-date" }),
      trade({ timestamp: "1700000200", price: "abc" }),
    ]);
    expect(series).toEqual([{ time: 1700000100, value: 195 }]);
  });
});

describe("TradesChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("mounts a line series and feeds the converted trades", () => {
    render(<TradesChart trades={[trade()]} />);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith([{ time: 1700000100, value: 190.5 }]);
    expect(screen.getByLabelText("체결 추이 차트")).toBeTruthy();
  });
});
