import { describe, expect, it } from "vitest";

import { parseJiraPollQueryParams } from "../poll-query";

describe("parseJiraPollQueryParams", () => {
  it("returns empty overrides when no params", () => {
    const r = parseJiraPollQueryParams(new URLSearchParams());
    expect(r).toEqual({});
  });

  it("parses jql (extra fragment after updated clause)", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("jql=AND+project+%3D+KAN"),
    );
    expect(r).toEqual({ extraJql: "AND project = KAN" });
  });

  it("accepts extraJql alias", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("extraJql=AND+status+%3D+%22To+Do%22"),
    );
    expect(r).toEqual({
      extraJql: 'AND status = "To Do"',
    });
  });

  it("prefers jql over extraJql when both set", () => {
    const r = parseJiraPollQueryParams(
      new URLSearchParams("jql=AND+a%3D1&extraJql=AND+b%3D2"),
    );
    expect(r).toEqual({ extraJql: "AND a=1" });
  });

  it("treats empty jql as absent (invalid / below minimum meaningful length)", () => {
    expect(parseJiraPollQueryParams(new URLSearchParams("jql="))).toEqual({});
    expect(parseJiraPollQueryParams(new URLSearchParams("jql"))).toEqual({});
  });

  it("treats whitespace-only jql as absent", () => {
    expect(parseJiraPollQueryParams(new URLSearchParams("jql=+++"))).toEqual(
      {},
    );
  });

  it("trims meaningful jql (exact boundary: single non-space token)", () => {
    expect(parseJiraPollQueryParams(new URLSearchParams("jql=+AND+"))).toEqual({
      extraJql: "AND",
    });
  });
});
