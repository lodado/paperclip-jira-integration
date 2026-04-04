import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JiraStorageRepository } from "../storage";
import type { JiraWebhookNormalizedEvent } from "../webhook";
import { processJiraWebhookEvent, type JiraSyncEnvironment } from "../sync";

function makeEvent(overrides?: Partial<JiraWebhookNormalizedEvent>): JiraWebhookNormalizedEvent {
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

function makeEnvironment(): JiraSyncEnvironment {
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

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: "MAY-100" }), { status: 200 }));
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
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://paperclip.example/api/companies/company-1/issues");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer test-key",
      })
    );

    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    expect(body).toEqual(
      expect.objectContaining({
        title: "Build Jira sync",
        status: "todo",
        priority: "high",
        projectId: "paperclip-project-1",
      })
    );

    const snapshot = repository.getSnapshot();
    expect(snapshot.externalIssueLinks["jira:cloud-1:10001"]?.internalIssueId).toBe(
      "MAY-100"
    );
    expect(snapshot.eventLogs["evt-1"]?.status).toBe("processed");
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
      .mockResolvedValue(new Response(JSON.stringify({ id: "MAY-200" }), { status: 200 }));
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
    expect(fetchMock.mock.calls[0][0]).toBe("https://paperclip.example/api/issues/MAY-200");

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<
      string,
      string
    >;
    expect(body).toEqual(
      expect.objectContaining({
        status: "done",
      })
    );
  });

  it("ignores duplicate idempotency keys", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: "MAY-300" }), { status: 200 }));
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
    expect(snapshot.eventLogs["evt-1"]?.status).toBe("ignored");
  });

  it("marks idempotency/event logs as failed on API errors", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-sync-"));
    const repository = await JiraStorageRepository.create({
      storeFilePath: path.join(tmpDir, "storage.json"),
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      processJiraWebhookEvent({
        event: makeEvent(),
        rawBody: JSON.stringify({ id: "payload-4" }),
        repository,
        environment: makeEnvironment(),
      })
    ).rejects.toThrow("Paperclip API POST /api/companies/company-1/issues failed");

    const snapshot = repository.getSnapshot();
    const idempotencyEntries = Object.values(snapshot.idempotency);

    expect(idempotencyEntries).toHaveLength(1);
    expect(idempotencyEntries[0]?.status).toBe("failed");
    expect(snapshot.eventLogs["evt-1"]?.status).toBe("failed");
  });
});
