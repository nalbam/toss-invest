import { describe, expect, it, vi } from "vitest";
import { handleError } from "./respond";
import { TossApiError } from "@/lib/server/toss/client";

describe("handleError", () => {
  it("forwards a real TossApiError with its upstream status", async () => {
    const res = handleError(
      new TossApiError({
        status: 400,
        code: "invalid-request",
        message: "bad",
        requestId: "r1",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatchObject({
      code: "invalid-request",
      message: "bad",
      requestId: "r1",
    });
  });

  it("forwards a cross-bundle TossApiError (foreign class, same name marker)", async () => {
    // Simulates a TossApiError thrown by the global client from another webpack
    // bundle: same shape + `name`, but not `instanceof` this module's class.
    const foreign = Object.assign(new Error("요청 필드가 올바르지 않습니다."), {
      name: "TossApiError",
      status: 400,
      code: "invalid-request",
      requestId: "r2",
    });
    const res = handleError(foreign);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "invalid-request", requestId: "r2" });
  });

  it("maps an unknown error to a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = handleError(new Error("boom"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal-error");
    spy.mockRestore();
  });
});
