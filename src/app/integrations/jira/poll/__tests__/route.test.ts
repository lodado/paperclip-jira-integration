import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRunJiraPoll = vi.hoisted(() =>
  vi.fn(async () => ({ scanned: 0, results: [] as const })),
);

vi.mock("@/server/integrations/jira/poll", () => ({
  runJiraPoll: mockRunJiraPoll,
}));

import { GET } from "../route";

describe("GET /integrations/jira/poll (route handler)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockRunJiraPoll.mockClear();
    mockRunJiraPoll.mockResolvedValue({ scanned: 0, results: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 500 when auth is required but no CRON_SECRET / JIRA_POLL_SECRET", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("JIRA_POLL_SECRET", "");

    const res = await GET(
      new Request("http://localhost/integrations/jira/poll", {
        headers: { Authorization: "Bearer any" },
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/CRON_SECRET|JIRA_POLL_SECRET/);
    expect(mockRunJiraPoll).not.toHaveBeenCalled();
  });

  it("returns 401 when Bearer is missing (production-style NODE_ENV)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JIRA_POLL_SECRET", "expected-secret");

    const res = await GET(
      new Request("http://localhost/integrations/jira/poll"),
    );

    expect(res.status).toBe(401);
    expect(mockRunJiraPoll).not.toHaveBeenCalled();
  });

  it("returns 401 when Bearer token does not match secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JIRA_POLL_SECRET", "expected-secret");

    const res = await GET(
      new Request("http://localhost/integrations/jira/poll", {
        headers: { Authorization: "Bearer wrong" },
      }),
    );

    expect(res.status).toBe(401);
    expect(mockRunJiraPoll).not.toHaveBeenCalled();
  });

  it("returns 200 and forwards trimmed jql as extraJql when Bearer matches", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JIRA_POLL_SECRET", "expected-secret");

    const res = await GET(
      new Request(
        "http://localhost/integrations/jira/poll?jql=AND+project+%3D+KAN",
        {
          headers: { Authorization: "Bearer expected-secret" },
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockRunJiraPoll).toHaveBeenCalledWith({
      extraJql: "AND project = KAN",
    });
    const body = (await res.json()) as { ok?: boolean; scanned?: number };
    expect(body.ok).toBe(true);
    expect(body.scanned).toBe(0);
  });

  it("skips Bearer when NODE_ENV is development even if secret is unset", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("JIRA_POLL_SECRET", "");

    const res = await GET(
      new Request("http://localhost/integrations/jira/poll"),
    );

    expect(res.status).toBe(200);
    expect(mockRunJiraPoll).toHaveBeenCalledWith({});
  });
});
