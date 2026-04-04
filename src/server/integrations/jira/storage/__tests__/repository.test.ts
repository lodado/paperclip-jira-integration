import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { JiraStorageRepository, makeJiraExternalKey } from "../repository";
import { migrateJiraStorageSnapshot } from "../schema";

describe("makeJiraExternalKey", () => {
  it("builds deterministic external keys", () => {
    expect(makeJiraExternalKey("cloud-1", "10001")).toBe("jira:cloud-1:10001");
  });

  it("throws for missing inputs", () => {
    expect(() => makeJiraExternalKey("", "10001")).toThrow(
      "cloudId and issueId are required",
    );
  });
});

describe("JiraStorageRepository", () => {
  it("upserts issue links and supports lookups", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-storage-"));
    const storeFilePath = path.join(tmpDir, "store.json");

    const repository = await JiraStorageRepository.create({ storeFilePath });
    const created = await repository.upsertIssueLink({
      cloudId: "cloud-1",
      externalIssueId: "10001",
      externalIssueKey: "PROJ-1",
      internalIssueId: "MAY-16",
    });

    const externalKey = makeJiraExternalKey("cloud-1", "10001");

    expect(created.externalKey).toBe(externalKey);
    expect(
      repository.findIssueLinkByExternalKey(externalKey)?.internalIssueId,
    ).toBe("MAY-16");
    expect(
      repository.findIssueLinkByJiraIssue({
        cloudId: "cloud-1",
        externalIssueId: "10001",
      })?.externalIssueKey,
    ).toBe("PROJ-1");
  });

  it("claims idempotency keys once", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-storage-"));
    const storeFilePath = path.join(tmpDir, "store.json");

    const repository = await JiraStorageRepository.create({ storeFilePath });
    const externalKey = makeJiraExternalKey("cloud-1", "10001");

    const first = await repository.claimIdempotencyKey({
      idempotencyKey: "evt-123",
      externalKey,
      externalEventId: "evt-123",
      payloadHash: "hash-1",
    });

    const second = await repository.claimIdempotencyKey({
      idempotencyKey: "evt-123",
      externalKey,
      externalEventId: "evt-123",
      payloadHash: "hash-1",
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const updated = await repository.markIdempotencyStatus({
      idempotencyKey: "evt-123",
      status: "processed",
    });

    expect(updated.status).toBe("processed");
  });

  it("keeps one idempotency row per Jira ticket after processed", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-storage-"));
    const storeFilePath = path.join(tmpDir, "store.json");
    const repository = await JiraStorageRepository.create({ storeFilePath });
    const externalKey = makeJiraExternalKey("cloud-1", "10001");

    await repository.claimIdempotencyKey({
      idempotencyKey: "old-poll",
      externalKey,
      externalEventId: "poll:1",
    });
    await repository.markIdempotencyStatus({
      idempotencyKey: "old-poll",
      status: "processed",
    });

    await repository.claimIdempotencyKey({
      idempotencyKey: "new-poll",
      externalKey,
      externalEventId: "poll:2",
    });
    await repository.markIdempotencyStatus({
      idempotencyKey: "new-poll",
      status: "processed",
    });

    const keys = Object.keys(repository.getSnapshot().idempotency);
    expect(keys).toEqual(["new-poll"]);
  });

  it("recordEventLog replaces prior logs for the same ticket", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-storage-"));
    const storeFilePath = path.join(tmpDir, "store.json");
    const repository = await JiraStorageRepository.create({ storeFilePath });
    const externalKey = makeJiraExternalKey("cloud-1", "10001");

    await repository.recordEventLog({
      externalEventId: "evt-a",
      externalKey,
      eventType: "issue.updated",
      status: "processed",
      payloadHash: "h1",
    });
    await repository.recordEventLog({
      externalEventId: "evt-b",
      externalKey,
      eventType: "issue.updated",
      status: "failed",
      payloadHash: "h2",
      error: "x",
    });

    const logs = repository.getSnapshot().eventLogs;
    expect(Object.keys(logs)).toEqual([externalKey]);
    expect(logs[externalKey]?.status).toBe("failed");
    expect(logs[externalKey]?.externalEventId).toBe("evt-b");
  });

  it("migrates legacy storage shape on startup", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-storage-"));
    const storeFilePath = path.join(tmpDir, "store.json");

    const legacyPayload = {
      external_issue_links: [
        {
          provider: "jira",
          cloudId: "cloud-1",
          externalIssueId: "10001",
          externalIssueKey: "PROJ-1",
          internalIssueId: "MAY-16",
        },
      ],
      integration_event_logs: [
        {
          externalEventId: "evt-123",
          externalKey: "jira:cloud-1:10001",
          eventType: "issue.created",
          status: "processed",
          payloadHash: "abc",
        },
      ],
    };

    await fs.writeFile(storeFilePath, JSON.stringify(legacyPayload), "utf8");

    const repository = await JiraStorageRepository.create({ storeFilePath });
    const snapshot = repository.getSnapshot();

    expect(snapshot.schemaVersion).toBe(1);
    expect(
      snapshot.externalIssueLinks["jira:cloud-1:10001"]?.internalIssueId,
    ).toBe("MAY-16");
    expect(snapshot.eventLogs["evt-123"]?.eventType).toBe("issue.created");
  });
});

describe("migrateJiraStorageSnapshot", () => {
  it("returns an empty schema for invalid input", () => {
    const snapshot = migrateJiraStorageSnapshot(null);

    expect(snapshot.schemaVersion).toBe(1);
    expect(Object.keys(snapshot.externalIssueLinks)).toHaveLength(0);
    expect(Object.keys(snapshot.idempotency)).toHaveLength(0);
    expect(Object.keys(snapshot.eventLogs)).toHaveLength(0);
  });
});
