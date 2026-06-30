// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleCard } from "./CollapsibleCard";
import {
  __resetSettingsStore,
  __seedSettings,
  getStoredItem,
} from "./settingsStore";

afterEach(() => {
  cleanup();
  __resetSettingsStore();
});

describe("CollapsibleCard", () => {
  it("toggles the body and stores the collapsed state", () => {
    render(
      <CollapsibleCard title="시세" storageId="market-quote">
        <p>본문</p>
      </CollapsibleCard>,
    );

    const toggle = screen.getByRole("button", { name: "시세" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("본문")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("본문")).not.toBeInTheDocument();
    expect(getStoredItem("toss-invest:collapsed:market-quote")).toBe("true");
  });

  it("restores a previously collapsed state", async () => {
    __seedSettings({ "toss-invest:collapsed:orders": "true" });

    render(
      <CollapsibleCard title="주문내역" storageId="orders">
        <p>주문 목록</p>
      </CollapsibleCard>,
    );

    expect(
      await screen.findByRole("button", { expanded: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText("주문 목록")).not.toBeInTheDocument();
  });

  it("shows summary content while collapsed", async () => {
    __seedSettings({ "toss-invest:collapsed:cash": "true" });

    render(
      <CollapsibleCard
        title="주문 가능 금액"
        storageId="cash"
        summary={<span>총 주문가능 ₩1,000</span>}
      >
        <p>상세 금액</p>
      </CollapsibleCard>,
    );

    expect(await screen.findByText("총 주문가능 ₩1,000")).toBeInTheDocument();
    expect(screen.queryByText("상세 금액")).not.toBeInTheDocument();
  });

  it("does not show refresh text while refreshing", () => {
    render(
      <CollapsibleCard title="시세" storageId="market-quote" refreshing>
        <p>본문</p>
      </CollapsibleCard>,
    );

    expect(screen.queryByText("새로고침")).not.toBeInTheDocument();
  });
});
