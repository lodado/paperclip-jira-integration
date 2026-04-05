import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolvePlannerBearerSecret,
  verifyJiraPlannerRequest,
} from "../task-auth";

describe("task-auth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolvePlannerBearerSecret prefers JIRA_PLANNER_SECRET", () => {
    vi.stubEnv("JIRA_PLANNER_SECRET", "planner");
    vi.stubEnv("CRON_SECRET", "cron");
    vi.stubEnv("JIRA_POLL_SECRET", "poll");
    expect(resolvePlannerBearerSecret()).toBe("planner");
  });

  it("verifyJiraPlannerRequest accepts matching Bearer token", () => {
    vi.stubEnv("JIRA_PLANNER_SECRET", "planner-secret");
    const request = new Request("http://localhost", {
      headers: { Authorization: "Bearer planner-secret" },
    });
    expect(verifyJiraPlannerRequest(request)).toBe(true);
  });

  it("verifyJiraPlannerRequest rejects wrong Bearer token", () => {
    vi.stubEnv("JIRA_PLANNER_SECRET", "planner-secret");
    const request = new Request("http://localhost", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(verifyJiraPlannerRequest(request)).toBe(false);
  });
});
