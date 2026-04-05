import { describe, expect, it } from "vitest";

import { parseJiraPollQueryParams } from "../poll-query";

describe("parseJiraPollQueryParams", () => {
  it("returns empty overrides when no params", () => {
    const r = parseJiraPollQueryParams(new URLSearchParams());
    expect(r).toEqual({ ok: true });
  });

  it("parses lookbackMinutes", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("lookbackMinutes=30"),
    );
    expect(r).toEqual({ ok: true, lookbackMinutes: 30 });
  });

  it("accepts lookback alias", () => {
    const r = parseJiraPollQueryParams(new URLSearchParams("lookback=15"));
    expect(r).toEqual({ ok: true, lookbackMinutes: 15 });
  });

  it("prefers lookbackMinutes over lookback", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("lookbackMinutes=20&lookback=99"),
    );
    expect(r).toEqual({ ok: true, lookbackMinutes: 20 });
  });

  it("rejects invalid lookback", () => {
    const r = parseJiraPollQueryParams(new URLSearchParams("lookback=0"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("lookback");
    }
  });

  it("parses jql (extra fragment after updated clause)", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("jql=AND+project+%3D+KAN"),
    );
    expect(r).toEqual({ ok: true, extraJql: "AND project = KAN" });
  });

  it("accepts extraJql alias", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("extraJql=AND+status+%3D+%22To+Do%22"),
    );
    expect(r).toEqual({
      ok: true,
      extraJql: 'AND status = "To Do"',
    });
  });

  it("prefers jql over extraJql when both set", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("jql=AND+a%3D1&extraJql=AND+b%3D2"),
    );
    expect(r).toEqual({ ok: true, extraJql: "AND a=1" });
  });

  it("parses jqlOnly with full jql", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("jqlOnly=1&jql=statusCategory+%3D+%22To+Do%22"),
    );
    expect(r).toEqual({
      ok: true,
      extraJql: 'statusCategory = "To Do"',
      jqlOnly: true,
    });
  });

  it("accepts fullJql alias for jqlOnly flag", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("fullJql=true&jql=project+%3D+KAN"),
    );
    expect(r).toEqual({
      ok: true,
      extraJql: "project = KAN",
      jqlOnly: true,
    });
  });

  it("rejects jqlOnly without jql", () => {
    const r = parseJiraPollQueryParams(new URLSearchParams("jqlOnly=1"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("jqlOnly");
    }
  });
});
