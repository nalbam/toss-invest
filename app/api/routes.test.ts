import { beforeEach, describe, expect, it, vi } from "vitest";
import { TossApiError } from "@/lib/server/toss/client";

// Mock the server container so route handlers exercise only their own
// validation/mapping logic against a fake endpoint facade.
const facade = {
  getAccounts: vi.fn(),
  getHoldings: vi.fn(),
  getPrices: vi.fn(),
  getExchangeRate: vi.fn(),
};

vi.mock("@/lib/server/toss/container", () => ({
  getServerTossClient: () => facade,
}));

import { GET as accountsGET } from "@/app/api/accounts/route";
import { GET as holdingsGET } from "@/app/api/holdings/route";
import { GET as pricesGET } from "@/app/api/prices/route";
import { GET as exchangeRateGET } from "@/app/api/exchange-rate/route";

const SECRET = "super-secret-client-secret-value";

function req(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- accounts ---------------------------------------------------------------

describe("GET /api/accounts", () => {
  it("returns 200 with the accounts under a data envelope", async () => {
    const accounts = [
      { accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" },
    ];
    facade.getAccounts.mockResolvedValue(accounts);

    const res = await accountsGET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: accounts });
  });

  it("maps a TossApiError to its status without leaking secrets", async () => {
    facade.getAccounts.mockRejectedValue(
      new TossApiError({
        status: 404,
        code: "account-not-found",
        message: "account not found",
        requestId: "req-1",
      }),
    );

    const res = await accountsGET();

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("account-not-found");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("maps an unknown error to a generic 500", async () => {
    facade.getAccounts.mockRejectedValue(
      new Error(`boom containing ${SECRET}`),
    );

    const res = await accountsGET();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal-error");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

// --- holdings ---------------------------------------------------------------

describe("GET /api/holdings", () => {
  const holdings = { items: [] };

  it("uses the provided accountSeq and forwards the symbol", async () => {
    facade.getHoldings.mockResolvedValue(holdings);

    const res = await holdingsGET(
      req("http://localhost/api/holdings?accountSeq=7&symbol=005930"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: holdings });
    expect(facade.getHoldings).toHaveBeenCalledWith({
      accountSeq: 7,
      symbol: "005930",
    });
    expect(facade.getAccounts).not.toHaveBeenCalled();
  });

  it("falls back to the first account's accountSeq when omitted", async () => {
    facade.getAccounts.mockResolvedValue([
      { accountNo: "1", accountSeq: 42, accountType: "BROKERAGE" },
      { accountNo: "2", accountSeq: 99, accountType: "BROKERAGE" },
    ]);
    facade.getHoldings.mockResolvedValue(holdings);

    const res = await holdingsGET(req("http://localhost/api/holdings"));

    expect(res.status).toBe(200);
    expect(facade.getAccounts).toHaveBeenCalledOnce();
    expect(facade.getHoldings).toHaveBeenCalledWith({
      accountSeq: 42,
      symbol: undefined,
    });
  });

  it("returns 400 for a non-integer accountSeq", async () => {
    const res = await holdingsGET(
      req("http://localhost/api/holdings?accountSeq=abc"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getHoldings).not.toHaveBeenCalled();
  });

  it("maps an upstream TossApiError to its status", async () => {
    facade.getHoldings.mockRejectedValue(
      new TossApiError({
        status: 404,
        code: "account-not-found",
        message: "account not found",
      }),
    );

    const res = await holdingsGET(
      req("http://localhost/api/holdings?accountSeq=7"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("account-not-found");
  });
});

// --- prices -----------------------------------------------------------------

describe("GET /api/prices", () => {
  it("splits symbols into an array and returns 200", async () => {
    const prices = [{ symbol: "005930", lastPrice: "72000", currency: "KRW" }];
    facade.getPrices.mockResolvedValue(prices);

    const res = await pricesGET(
      req("http://localhost/api/prices?symbols=005930,000660"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: prices });
    expect(facade.getPrices).toHaveBeenCalledWith({
      symbols: ["005930", "000660"],
    });
  });

  it("returns 400 when symbols is missing", async () => {
    const res = await pricesGET(req("http://localhost/api/prices"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getPrices).not.toHaveBeenCalled();
  });
});

// --- exchange-rate ----------------------------------------------------------

describe("GET /api/exchange-rate", () => {
  const rate = { baseCurrency: "USD", quoteCurrency: "KRW", rate: "1380.5" };

  it("forwards base/quote/dateTime and returns 200", async () => {
    facade.getExchangeRate.mockResolvedValue(rate);

    const res = await exchangeRateGET(
      req(
        "http://localhost/api/exchange-rate?baseCurrency=USD&quoteCurrency=KRW&dateTime=2026-03-25T09:30:00%2B09:00",
      ),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: rate });
    expect(facade.getExchangeRate).toHaveBeenCalledWith({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      dateTime: "2026-03-25T09:30:00+09:00",
    });
  });

  it("returns 400 when quoteCurrency is missing", async () => {
    const res = await exchangeRateGET(
      req("http://localhost/api/exchange-rate?baseCurrency=USD"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid-request");
    expect(facade.getExchangeRate).not.toHaveBeenCalled();
  });
});
