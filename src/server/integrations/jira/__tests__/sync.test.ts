import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JiraStorageRepository } from "../storage";
import type { JiraWebhookNormalizedEvent } from "../webhook";
import { processJiraWebhookEvent, type JiraSyncEnvironment } from "../sync";

function makeEvent(
  overrides?: Partial<JiraWebhookNormalizedEvent>,
): JiraWebhookNormalizedEvent {
  return {
    provider: "jira",
    eventType: "issue.created",
    externalEventId: "evt-1",
    timestamp: 1710000000000,
    issue: {
      id: "10001",
      key: "PROJ-1",
      summary: "Build Jira sync",
      description: "details",
      priority: "High",
      status: "To Do",
      issueType: "Task",
      projectId: "20001",
      projectKey: "PROJ",
      url: "https://jira.example/rest/api/3/issue/10001",
    },
    changes: [],
    ...overrides,
  };
}

function makeEnvironment(
  overrides?: Partial<JiraSyncEnvironment>,
): JiraSyncEnvironment {
  return {
    apiUrl: "https://paperclip.example",
    apiKey: "test-key",
    companyId: "company-1",
    cloudId: "cloud-1",
    integrationParentIssueId: null,
    defaultProjectId: null,
    projectMapping: {
      proj: "paperclip-project-1",
      "20001": "paperclip-project-1",
    },
    newIssueAssigneeAgentId: null,
    newIssueAssigneeAgentUrlKey: null,
    ...overrides,
  };
}

describe("processJiraWebhookEvent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates issue and records link/event log for created events", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (
        url === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "GET"
      ) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "MAY-100" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await processJiraWebhookEvent({
      event: makeEvent(),
      rawBody: JSON.stringify({ id: "payload-1" }),
      repository,
      environment: makeEnvironment(),
    });

    expect(result.outcome).toBe("processed");
    expect(result.reason).toBe("created");
    expect(result.internalIssueId).toBe("MAY-100");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "POST",
    );
    expect(createCall).toBeDefined();
    const [url, init] = createCall!;
    expect(url).toBe(
      "https://paperclip.example/api/companies/company-1/issues",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer test-key",
      }),
    );

    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    expect(body).toEqual(
      expect.objectContaining({
        title: "Build Jira sync",
        status: "todo",
        priority: "high",
        projectId: "paperclip-project-1",
      }),
    );
    expect(body.description).toContain("Synced from Jira issue PROJ-1");
    expect(body.description).toContain("## Plan (draft, from Jira)");
    expect(body.description).toContain("### Objective");
    expect(body.description).toContain("Build Jira sync");
    expect(body.description).toContain("### Context (Jira description)");
    expect(body.description).toContain("details");
    expect(body).not.toHaveProperty("assigneeAgentId");

    const snapshot = repository.getSnapshot();
    expect(
      snapshot.externalIssueLinks["jira:cloud-1:10001"]?.internalIssueId,
    ).toBe("MAY-100");
    expect(snapshot.eventLogs["jira:cloud-1:10001"]?.status).toBe("processed");
  });

  it("updates existing linked issue for updated events", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });
    await repository.upsertIssueLink({
      cloudId: "cloud-1",
      externalIssueId: "10001",
      externalIssueKey: "PROJ-1",
      internalIssueId: "MAY-200",
    });

    const event = makeEvent({
      eventType: "issue.updated",
      issue: {
        ...makeEvent().issue,
        status: "Done",
      },
      changes: [
        {
          fieldId: "status",
          field: "status",
          from: "10000",
          to: "10001",
          fromString: "To Do",
          toString: "Done",
        },
      ],
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "MAY-200" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await processJiraWebhookEvent({
      event,
      rawBody: JSON.stringify({ id: "payload-2" }),
      repository,
      environment: makeEnvironment(),
    });

    expect(result.outcome).toBe("processed");
    expect(result.reason).toBe("updated");
    expect(result.internalIssueId).toBe("MAY-200");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://paperclip.example/api/issues/MAY-200",
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<
      string,
      string
    >;
    expect(body).toEqual(
      expect.objectContaining({
        status: "done",
      }),
    );
    expect(body).not.toHaveProperty("assigneeAgentId");
  });

  it("sets assigneeAgentId on create when newIssueAssigneeAgentId is configured", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (
        url === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "GET"
      ) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "MAY-101" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ctoId = "82a0892c-c077-44f6-a54f-f7af59960a70";
    await processJiraWebhookEvent({
      event: makeEvent({ externalEventId: "evt-assignee" }),
      rawBody: JSON.stringify({ id: "payload-assignee" }),
      repository,
      environment: makeEnvironment({ newIssueAssigneeAgentId: ctoId }),
    });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "POST",
    );
    expect(createCall).toBeDefined();
    const [, init] = createCall!;
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    expect(body.assigneeAgentId).toBe(ctoId);
  });

  it("resolves assigneeAgentId via newIssueAssigneeAgentUrlKey when id is unset", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const controllerId = "9aa4c86c-8cdd-4631-85dd-4b4e9416275b";
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://paperclip.example/api/companies/company-1/agents") {
        return new Response(
          JSON.stringify([
            {
              id: controllerId,
              urlKey: "jira-controller",
            },
          ]),
          { status: 200 },
        );
      }
      if (url === "https://paperclip.example/api/companies/company-1/issues") {
        return new Response(JSON.stringify({ id: "MAY-101" }), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await processJiraWebhookEvent({
      event: makeEvent({ externalEventId: "evt-assignee-url-key" }),
      rawBody: JSON.stringify({ id: "payload-assignee-url-key" }),
      repository,
      environment: makeEnvironment({
        newIssueAssigneeAgentId: null,
        newIssueAssigneeAgentUrlKey: "jira-controller",
      }),
    });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "POST",
    );
    expect(createCall).toBeDefined();
    const createBody = JSON.parse(String(createCall?.[1]?.body)) as Record<
      string,
      string
    >;
    expect(createBody.assigneeAgentId).toBe(controllerId);
  });

  it("ignores duplicate idempotency keys", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (
        url === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "GET"
      ) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "MAY-300" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const event = makeEvent();
    await processJiraWebhookEvent({
      event,
      rawBody: JSON.stringify({ id: "payload-3" }),
      repository,
      environment: makeEnvironment(),
    });

    fetchMock.mockClear();

    const duplicateResult = await processJiraWebhookEvent({
      event,
      rawBody: JSON.stringify({ id: "payload-3" }),
      repository,
      environment: makeEnvironment(),
    });

    expect(duplicateResult.outcome).toBe("ignored");
    expect(duplicateResult.reason).toBe("duplicate");
    expect(fetchMock).not.toHaveBeenCalled();

    const snapshot = repository.getSnapshot();
    expect(snapshot.eventLogs["jira:cloud-1:10001"]?.status).toBe("processed");
  });

  it("sets parentId on create when integrationParentIssueId is configured", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (
        url === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "GET"
      ) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "MAY-102" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await processJiraWebhookEvent({
      event: makeEvent({ externalEventId: "evt-parent-id" }),
      rawBody: JSON.stringify({ id: "payload-parent-id" }),
      repository,
      environment: makeEnvironment({
        integrationParentIssueId: "85d756e6-3b38-4aa3-91f1-898d5355f537",
      }),
    });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "POST",
    );
    expect(createCall).toBeDefined();
    const [, init] = createCall!;
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    expect(body.parentId).toBe("85d756e6-3b38-4aa3-91f1-898d5355f537");
  });

  it("reuses existing Paperclip issue when storage link is missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);

      if (
        url === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "GET"
      ) {
        return new Response(
          JSON.stringify([
            {
              id: "MAY-400",
              description: [
                "Synced from Jira issue PROJ-1.",
                "",
                "- Jira Issue ID: 10001",
              ].join("\n"),
            },
          ]),
          { status: 200 },
        );
      }

      if (url === "https://paperclip.example/api/issues/MAY-400") {
        return new Response(JSON.stringify({ id: "MAY-400" }), { status: 200 });
      }

      if (url === "https://paperclip.example/api/companies/company-1/issues") {
        return new Response("should not create", { status: 500 });
      }

      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await processJiraWebhookEvent({
      event: makeEvent({
        eventType: "issue.updated",
        externalEventId: "evt-dedupe-fallback",
      }),
      rawBody: JSON.stringify({ id: "payload-dedupe-fallback" }),
      repository,
      environment: makeEnvironment(),
    });

    expect(result.outcome).toBe("processed");
    expect(result.reason).toBe("updated");
    expect(result.internalIssueId).toBe("MAY-400");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url) === "https://paperclip.example/api/companies/company-1/issues" &&
          (init?.method || "GET") === "POST",
      ).length,
    ).toBe(0);
  });

  it("marks idempotency/event logs as failed on API errors", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (
        url === "https://paperclip.example/api/companies/company-1/issues" &&
        (init?.method || "GET") === "GET"
      ) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      processJiraWebhookEvent({
        event: makeEvent(),
        rawBody: JSON.stringify({ id: "payload-4" }),
        repository,
        environment: makeEnvironment(),
      }),
    ).rejects.toThrow(
      "Paperclip API POST /api/companies/company-1/issues failed",
    );

    const snapshot = repository.getSnapshot();
    const idempotencyEntries = Object.values(snapshot.idempotency);

    expect(idempotencyEntries).toHaveLength(1);
    expect(idempotencyEntries[0]?.status).toBe("failed");
    expect(snapshot.eventLogs["jira:cloud-1:10001"]?.status).toBe("failed");
  });
});
