import { describe, expect, it, vi } from "vitest";

import {
  buildPlannerDescriptionAdf,
  createJiraTask,
  resolveJiraCreateTaskEnvironment,
  validateCreateJiraTaskInput,
  type JiraCreateTaskEnvironment,
} from "../create-task";

describe("validateCreateJiraTaskInput", () => {
  it("enforces summary boundary values", () => {
    expect(validateCreateJiraTaskInput({ summary: "ab" }).ok).toBe(false);
    expect(validateCreateJiraTaskInput({ summary: "abc" }).ok).toBe(true);
    expect(validateCreateJiraTaskInput({ summary: "a".repeat(255) }).ok).toBe(
      true,
    );
    expect(validateCreateJiraTaskInput({ summary: "a".repeat(256) }).ok).toBe(
      false,
    );
  });

  it("accepts optional assigneeAccountId", () => {
    const parsed = validateCreateJiraTaskInput({
      summary: "abc",
      assigneeAccountId: "  acc-1  ",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.assigneeAccountId).toBe("acc-1");
    }
  });
});

describe("buildPlannerDescriptionAdf", () => {
  it("renders spec-driven sections as Jira ADF", () => {
    const adf = buildPlannerDescriptionAdf({
      summary: "Create login task",
      requirements: "User can sign in with SSO",
      spec: {
        context: "Auth module in monorepo",
        acceptanceCriteria: ["Given valid SSO token, user lands on dashboard"],
        verification: ["pnpm test", "pnpm type-check"],
      },
    });

    expect(adf.type).toBe("doc");
    expect(adf.content.some((node) => node.type === "heading")).toBe(true);
    expect(JSON.stringify(adf)).toContain("Objective");
    expect(JSON.stringify(adf)).toContain("Raw Requirements");
    expect(JSON.stringify(adf)).toContain("Acceptance Criteria");
    expect(JSON.stringify(adf)).toContain("Verification");
  });
});

describe("createJiraTask", () => {
  const environment: JiraCreateTaskEnvironment = {
    email: "planner@example.com",
    apiToken: "token-1",
    cloudId: "cloud-1",
    defaultProjectKey: "MAY",
    defaultIssueType: "Task",
    apiBaseUrl: "https://api.atlassian.com",
    defaultAssigneeAccountId: null,
    assignToApiUser: false,
  };

  it("creates Jira issue with default project key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const fields = body.fields as Record<string, unknown>;
      expect((fields.project as { key: string }).key).toBe("MAY");
      expect((fields.issuetype as { name: string }).name).toBe("Task");
      expect(fields.summary).toBe("Spec-driven task");

      return new Response(
        JSON.stringify({
          id: "10001",
          key: "MAY-101",
          self: "https://example.atlassian.net/browse/MAY-101",
        }),
        { status: 201 },
      );
    });

    const created = await createJiraTask({
      input: {
        summary: "Spec-driven task",
        requirements: "Break down scope and acceptance criteria",
      },
      environment,
      fetchImpl: fetchMock,
    });

    expect(created).toEqual({
      id: "10001",
      key: "MAY-101",
      url: "https://example.atlassian.net/browse/MAY-101",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/ex/jira/cloud-1/rest/api/3/issue",
    );
  });

  it("fails when no projectKey is available", async () => {
    await expect(
      createJiraTask({
        input: { summary: "No project" },
        environment: { ...environment, defaultProjectKey: null },
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow(/projectKey is required/);
  });

  it("includes assignee when assigneeAccountId is provided", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const fields = body.fields as Record<string, unknown>;
      expect(fields.assignee).toEqual({
        accountId: "acc-123",
      });

      return new Response(
        JSON.stringify({
          id: "10001",
          key: "MAY-102",
          self: "https://example.atlassian.net/browse/MAY-102",
        }),
        { status: 201 },
      );
    });

    await createJiraTask({
      input: {
        summary: "Assigned task",
        assigneeAccountId: "acc-123",
      },
      environment,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves assignee from myself when assignToApiUser is true", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);

      if (url.includes("/rest/api/3/myself")) {
        expect(init?.method).toBeUndefined();
        return new Response(JSON.stringify({ accountId: "me-acc" }), {
          status: 200,
        });
      }

      if (url.includes("/rest/api/3/issue")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const fields = body.fields as Record<string, unknown>;
        expect(fields.assignee).toEqual({ accountId: "me-acc" });
        return new Response(
          JSON.stringify({
            id: "10001",
            key: "MAY-103",
            self: "https://example.atlassian.net/browse/MAY-103",
          }),
          { status: 201 },
        );
      }

      return new Response("not found", { status: 404 });
    });

    await createJiraTask({
      input: { summary: "Auto-assign to token user" },
      environment: { ...environment, assignToApiUser: true },
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("resolveJiraCreateTaskEnvironment", () => {
  it("reads planner defaults from env", () => {
    vi.stubEnv("JIRA_ATLASSIAN_EMAIL", "planner@example.com");
    vi.stubEnv("JIRA_ATLASSIAN_API_TOKEN", "token");
    vi.stubEnv("JIRA_CLOUD_ID", "cloud-1");
    vi.stubEnv("JIRA_PLANNER_DEFAULT_PROJECT_KEY", "MAY");
    vi.stubEnv("JIRA_PLANNER_DEFAULT_ISSUE_TYPE", "Story");
    vi.stubEnv("JIRA_ATLASSIAN_API_BASE_URL", "https://api.example.com/");
    vi.stubEnv("JIRA_PLANNER_DEFAULT_ASSIGNEE_ACCOUNT_ID", "acc-default");
    vi.stubEnv("JIRA_PLANNER_ASSIGN_TO_API_USER", "true");

    const env = resolveJiraCreateTaskEnvironment();
    expect(env.defaultProjectKey).toBe("MAY");
    expect(env.defaultIssueType).toBe("Story");
    expect(env.apiBaseUrl).toBe("https://api.example.com");
    expect(env.defaultAssigneeAccountId).toBe("acc-default");
    expect(env.assignToApiUser).toBe(true);

    vi.unstubAllEnvs();
  });
});
