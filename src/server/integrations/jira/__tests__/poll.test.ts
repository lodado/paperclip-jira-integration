import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jiraSearchIssueToNormalizedEvent, runJiraPoll } from "../poll";
import { JiraStorageRepository } from "../storage";
import type { JiraSyncEnvironment } from "../sync";

describe("jiraSearchIssueToNormalizedEvent", () => {
  it("maps REST search issue fields to a normalized updated event", () => {
    const event = jiraSearchIssueToNormalizedEvent(
      {
        id: "10001",
        key: "PROJ-2",
        self: "https://example.atlassian.net/rest/api/3/issue/10001",
        fields: {
          summary: "Title",
          description: { type: "doc", content: [] },
          priority: { name: "Medium" },
          status: { name: "In Progress" },
          issuetype: { name: "Bug" },
          project: { id: "20001", key: "PROJ" },
          updated: "2024-06-01T12:00:00.000+0000",
        },
      },
      "cloud-xyz",
    );

    expect(event.eventType).toBe("issue.updated");
    expect(event.changes).toEqual([]);
    expect(event.externalEventId).toBe(
      "poll:cloud-xyz:10001:2024-06-01T12:00:00.000+0000",
    );
    expect(event.issue).toEqual(
      expect.objectContaining({
        id: "10001",
        key: "PROJ-2",
        summary: "Title",
        description: JSON.stringify({ type: "doc", content: [] }),
        priority: "Medium",
        status: "In Progress",
        issueType: "Bug",
        projectId: "20001",
        projectKey: "PROJ",
        url: "https://example.atlassian.net/rest/api/3/issue/10001",
      }),
    );
  });
});

function makePollEnvironment(): JiraSyncEnvironment {
  return {
    apiUrl: "https://paperclip.example",
    apiKey: "test-key",
    companyId: "company-1",
    cloudId: "cloud-1",
    defaultProjectId: null,
    projectMapping: {
      proj: "paperclip-project-1",
      "20001": "paperclip-project-1",
    },
  };
}

describe("runJiraPoll", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches Jira issues and creates Paperclip issues via processJiraWebhookEvent", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-poll-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const jiraIssue = {
      id: "10001",
      key: "PROJ-1",
      self: "https://example/rest/api/3/issue/10001",
      fields: {
        summary: "From poll",
        updated: "2024-06-01T12:00:00.000+0000",
        priority: { name: "High" },
        status: { name: "To Do" },
        issuetype: { name: "Task" },
        project: { id: "20001", key: "PROJ" },
      },
    };

    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.atlassian.com")) {
        return new Response(
          JSON.stringify({
            issues: [jiraIssue],
            total: 1,
            startAt: 0,
            maxResults: 50,
          }),
          { status: 200 },
        );
      }
      if (url.includes("paperclip.example")) {
        return new Response(JSON.stringify({ id: "PC-POLL-1" }), {
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await runJiraPoll({
      fetchImpl: fetchMock,
      auth: {
        email: "user@example.com",
        apiToken: "token",
        cloudId: "cloud-1",
      },
      repository,
      environment: makePollEnvironment(),
      lookbackMinutes: 10,
    });

    expect(result.scanned).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        ok: true,
        issueKey: "PROJ-1",
        reason: "created",
      }),
    );

    const jiraCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("api.atlassian.com"),
    );
    expect(jiraCall).toBeDefined();
    const [, jiraInit] = jiraCall!;
    expect(jiraInit?.headers).toEqual(
      expect.objectContaining({
        Authorization: expect.stringMatching(/^Basic /) as string,
      }),
    );

    expect(
      repository.getSnapshot().externalIssueLinks["jira:cloud-1:10001"]
        ?.internalIssueId,
    ).toBe("PC-POLL-1");
  });

  it("second poll with same Jira updated timestamp is ignored as duplicate", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-poll-dup-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const jiraIssue = {
      id: "10001",
      key: "PROJ-1",
      self: "https://example/rest/api/3/issue/10001",
      fields: {
        summary: "Same",
        updated: "2024-06-01T12:00:00.000+0000",
        priority: { name: "Low" },
        status: { name: "Done" },
        issuetype: { name: "Task" },
        project: { id: "20001", key: "PROJ" },
      },
    };

    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.atlassian.com")) {
        return new Response(
          JSON.stringify({
            issues: [jiraIssue],
            total: 1,
            startAt: 0,
            maxResults: 50,
          }),
          { status: 200 },
        );
      }
      if (url.includes("paperclip.example")) {
        return new Response(JSON.stringify({ id: "PC-POLL-1" }), {
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    await runJiraPoll({
      fetchImpl: fetchMock,
      auth: { email: "u@e.com", apiToken: "t", cloudId: "cloud-1" },
      repository,
      environment: makePollEnvironment(),
      lookbackMinutes: 10,
    });

    const paperclipCallsAfterFirst = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("paperclip.example"),
    ).length;

    await runJiraPoll({
      fetchImpl: fetchMock,
      auth: { email: "u@e.com", apiToken: "t", cloudId: "cloud-1" },
      repository,
      environment: makePollEnvironment(),
      lookbackMinutes: 10,
    });

    const paperclipCallsAfterSecond = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("paperclip.example"),
    ).length;

    expect(paperclipCallsAfterFirst).toBe(1);
    expect(paperclipCallsAfterSecond).toBe(1);
  });
});
