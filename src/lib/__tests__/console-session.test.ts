import { afterEach, describe, expect, it, vi } from "vitest";

import {
  signConsoleSession,
  verifyConsoleSessionToken,
} from "@/lib/console-session";

describe("console-session", () => {
  const secret = "unit-test-hmac-secret-value-32chars";

  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs and verifies a session", async () => {
    const token = await signConsoleSession(secret);
    const payload = await verifyConsoleSessionToken(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects wrong secret", async () => {
    const token = await signConsoleSession(secret);
    expect(await verifyConsoleSessionToken(token, "other-secret")).toBeNull();
  });

  it("rejects tampered token", async () => {
    const token = await signConsoleSession(secret);
    const [payloadPart, sigPart] = token.split(".");
    const flipped =
      (payloadPart![0] === "A" ? "B" : "A") + payloadPart!.slice(1);
    const tampered = `${flipped}.${sigPart}`;
    expect(await verifyConsoleSessionToken(tampered, secret)).toBeNull();
  });

  it("rejects expired session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const token = await signConsoleSession(secret);
    vi.setSystemTime(new Date("2035-01-01T00:00:00Z"));
    expect(await verifyConsoleSessionToken(token, secret)).toBeNull();
  });
});
