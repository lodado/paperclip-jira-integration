import { describe, expect, it } from "vitest";

import { timingSafeStringEqual } from "@/lib/timing-safe-string";

describe("timingSafeStringEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeStringEqual("same", "same")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeStringEqual("aaaa", "aaab")).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(timingSafeStringEqual("short", "longer")).toBe(false);
  });
});
