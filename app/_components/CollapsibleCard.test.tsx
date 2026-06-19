// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleCard } from "./CollapsibleCard";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
    expect(
      window.localStorage.getItem("toss-invest:collapsed:market-quote"),
    ).toBe("true");
  });

  it("restores a previously collapsed state", async () => {
    window.localStorage.setItem("toss-invest:collapsed:orders", "true");

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
});
