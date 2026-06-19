// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Money } from "./Money";
import styles from "./dashboard.module.css";

afterEach(cleanup);

describe("Money", () => {
  it("wraps a leading ₩ symbol in the currencySymbol span, keeping text intact", () => {
    const { container } = render(<Money value="₩1,234" />);
    const symbol = container.querySelector(`.${styles.currencySymbol}`);
    expect(symbol).not.toBeNull();
    expect(symbol?.textContent).toBe("₩");
    // The full rendered amount reads identically to the input string.
    expect(container.textContent).toBe("₩1,234");
  });

  it("wraps only the $ symbol for a negative USD value, after the minus sign", () => {
    const { container } = render(<Money value="-$97.50" />);
    const symbol = container.querySelector(`.${styles.currencySymbol}`);
    expect(symbol?.textContent).toBe("$");
    expect(container.textContent).toBe("-$97.50");
  });

  it("wraps the $ symbol for a positive USD value", () => {
    const { container } = render(<Money value="$1,234.50" />);
    const symbol = container.querySelector(`.${styles.currencySymbol}`);
    expect(symbol?.textContent).toBe("$");
    expect(container.textContent).toBe("$1,234.50");
  });

  it("renders a non-currency placeholder verbatim with no symbol span", () => {
    const { container } = render(<Money value="-" />);
    expect(container.querySelector(`.${styles.currencySymbol}`)).toBeNull();
    expect(container.textContent).toBe("-");
  });
});
