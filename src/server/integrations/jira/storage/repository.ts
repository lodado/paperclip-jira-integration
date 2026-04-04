import fs from "node:fs/promises";
import path from "node:path";

import {
  createEmptyJiraStorageSnapshot,
  migrateJiraStorageSnapshot,
  type JiraExternalIssueLink,
  type JiraIdempotencyRecord,
  type JiraIntegrationEventLog,
  type JiraStorageSnapshot,
} from "./schema";

export type JiraStorageRepositoryOptions = {
  storeFilePath?: string;
  cloudId?: string;
};

export type UpsertJiraIssueLinkInput = {
  cloudId: string;
  externalIssueId: string;
  externalIssueKey?: string | null;
  internalIssueId: string;
};

export type ClaimIdempotencyInput = {
  idempotencyKey: string;
  externalKey: string;
  externalEventId?: string | null;
  payloadHash?: string | null;
};

export type RecordJiraEventLogInput = {
  externalEventId?: string | null;
  externalKey: string;
  eventType: string;
  status: JiraIntegrationEventLog["status"];
  error?: string | null;
  payloadHash?: string | null;
};

const DEFAULT_STORAGE_DIR = path.resolve(
  process.cwd(),
  ".paperclip",
  "integrations",
);
const DEFAULT_STORAGE_FILE = path.resolve(
  DEFAULT_STORAGE_DIR,
  "jira-storage.json",
);

function cloneSnapshot(snapshot: JiraStorageSnapshot): JiraStorageSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    externalIssueLinks: { ...snapshot.externalIssueLinks },
    idempotency: { ...snapshot.idempotency },
    eventLogs: { ...snapshot.eventLogs },
  };
}

function toNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function makeJiraExternalKey(cloudId: string, issueId: string): string {
  const normalizedCloudId = cloudId.trim();
  const normalizedIssueId = issueId.trim();

  if (!normalizedCloudId || !normalizedIssueId) {
    throw new Error(
      "cloudId and issueId are required to build jira externalKey",
    );
  }

  return `jira:${normalizedCloudId}:${normalizedIssueId}`;
}

export class JiraStorageRepository {
  private readonly storeFilePath: string;

  private snapshot: JiraStorageSnapshot;

  private writeQueue: Promise<void>;

  private constructor(storeFilePath: string, snapshot: JiraStorageSnapshot) {
    this.storeFilePath = storeFilePath;
    this.snapshot = snapshot;
    this.writeQueue = Promise.resolve();
  }

  static async create(
    options: JiraStorageRepositoryOptions = {},
  ): Promise<JiraStorageRepository> {
    const storeFilePath =
      options.storeFilePath ||
      process.env.JIRA_STORAGE_FILE ||
      DEFAULT_STORAGE_FILE;

    const raw = await JiraStorageRepository.readRawSnapshot(storeFilePath);
    const snapshot = migrateJiraStorageSnapshot(raw);

    const repository = new JiraStorageRepository(storeFilePath, snapshot);
    await repository.persist();
    return repository;
  }

  getStoreFilePath(): string {
    return this.storeFilePath;
  }

  getSnapshot(): JiraStorageSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  findIssueLinkByExternalKey(
    externalKey: string,
  ): JiraExternalIssueLink | null {
    return this.snapshot.externalIssueLinks[externalKey] || null;
  }

  findIssueLinkByJiraIssue(params: {
    cloudId: string;
    externalIssueId: string;
  }): JiraExternalIssueLink | null {
    const externalKey = makeJiraExternalKey(
      params.cloudId,
      params.externalIssueId,
    );
    return this.findIssueLinkByExternalKey(externalKey);
  }

  async upsertIssueLink(
    input: UpsertJiraIssueLinkInput,
  ): Promise<JiraExternalIssueLink> {
    return this.withWriteLock(async () => {
      const externalKey = makeJiraExternalKey(
        input.cloudId,
        input.externalIssueId,
      );
      const now = new Date().toISOString();
      const existing = this.snapshot.externalIssueLinks[externalKey];

      const next: JiraExternalIssueLink = {
        provider: "jira",
        externalKey,
        cloudId: input.cloudId.trim(),
        externalIssueId: input.externalIssueId.trim(),
        externalIssueKey: toNullableString(input.externalIssueKey),
        internalIssueId: input.internalIssueId.trim(),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      this.snapshot.externalIssueLinks[externalKey] = next;
      await this.persist();
      return next;
    });
  }

  async claimIdempotencyKey(input: ClaimIdempotencyInput): Promise<boolean> {
    return this.withWriteLock(async () => {
      const key = input.idempotencyKey.trim();
      if (!key) {
        throw new Error("idempotencyKey is required");
      }

      const existing = this.snapshot.idempotency[key];
      if (existing) {
        return false;
      }

      const now = new Date().toISOString();
      const next: JiraIdempotencyRecord = {
        idempotencyKey: key,
        externalEventId: toNullableString(input.externalEventId),
        externalKey: input.externalKey,
        payloadHash: toNullableString(input.payloadHash),
        status: "processing",
        createdAt: now,
        updatedAt: now,
      };

      this.snapshot.idempotency[key] = next;
      await this.persist();
      return true;
    });
  }

  async markIdempotencyStatus(params: {
    idempotencyKey: string;
    status: JiraIdempotencyRecord["status"];
  }): Promise<JiraIdempotencyRecord> {
    return this.withWriteLock(async () => {
      const key = params.idempotencyKey.trim();
      const existing = this.snapshot.idempotency[key];

      if (!existing) {
        throw new Error(`idempotency key not found: ${key}`);
      }

      const next: JiraIdempotencyRecord = {
        ...existing,
        status: params.status,
        updatedAt: new Date().toISOString(),
      };

      this.snapshot.idempotency[key] = next;

      if (params.status === "processed" || params.status === "failed") {
        const ext = next.externalKey;
        for (const [otherKey, rec] of Object.entries(
          this.snapshot.idempotency,
        )) {
          if (rec.externalKey === ext && otherKey !== key) {
            delete this.snapshot.idempotency[otherKey];
          }
        }
      }

      await this.persist();
      return next;
    });
  }

  async recordEventLog(
    input: RecordJiraEventLogInput,
  ): Promise<JiraIntegrationEventLog> {
    return this.withWriteLock(async () => {
      const externalEventId = toNullableString(input.externalEventId);
      const processedAt = new Date().toISOString();
      const ticketKey = input.externalKey.trim();

      for (const [k, log] of Object.entries(this.snapshot.eventLogs)) {
        if (log.externalKey === ticketKey) {
          delete this.snapshot.eventLogs[k];
        }
      }

      const next: JiraIntegrationEventLog = {
        logKey: ticketKey,
        externalEventId,
        externalKey: ticketKey,
        eventType: input.eventType,
        status: input.status,
        error: toNullableString(input.error),
        payloadHash: toNullableString(input.payloadHash),
        processedAt,
      };

      this.snapshot.eventLogs[ticketKey] = next;
      await this.persist();
      return next;
    });
  }

  private async withWriteLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release: () => void = () => undefined;

    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await work();
    } finally {
      release();
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.storeFilePath), { recursive: true });
    await fs.writeFile(
      this.storeFilePath,
      `${JSON.stringify(this.snapshot, null, 2)}\n`,
      "utf8",
    );
  }

  private static async readRawSnapshot(
    storeFilePath: string,
  ): Promise<unknown> {
    try {
      const raw = await fs.readFile(storeFilePath, "utf8");
      return JSON.parse(raw) as unknown;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return createEmptyJiraStorageSnapshot();
      }

      return createEmptyJiraStorageSnapshot();
    }
  }
}
