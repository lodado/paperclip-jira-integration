import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePollBearerSecret, verifyJiraPollRequest } from "../poll-auth";

describe("poll-auth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolvePollBearerSecret prefers CRON_SECRET over JIRA_POLL_SECRET", () => {
    vi.stubEnv("CRON_SECRET", "cron");
    vi.stubEnv("JIRA_POLL_SECRET", "poll");
    expect(resolvePollBearerSecret()).toBe("cron");
  });

  it("verifyJiraPollRequest accepts a matching Bearer token", () => {
    vi.stubEnv("JIRA_POLL_SECRET", "secret-token");
    const request = new Request("http://localhost", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(verifyJiraPollRequest(request)).toBe(true);
  });

  it("verifyJiraPollRequest rejects a wrong token", () => {
    vi.stubEnv("JIRA_POLL_SECRET", "secret-token");
    const request = new Request("http://localhost", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(verifyJiraPollRequest(request)).toBe(false);
  });

  it("verifyJiraPollRequest rejects missing Authorization", () => {
    vi.stubEnv("JIRA_POLL_SECRET", "secret-token");
    const request = new Request("http://localhost");
    expect(verifyJiraPollRequest(request)).toBe(false);
  });
});
