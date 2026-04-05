import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

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
  "jira-storage.sqlite",
);
const DEFAULT_LEGACY_STORAGE_FILE = path.resolve(
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

  private readonly database: Database.Database;

  private snapshot: JiraStorageSnapshot;

  private writeQueue: Promise<void>;

  private constructor(
    storeFilePath: string,
    database: Database.Database,
    snapshot: JiraStorageSnapshot,
  ) {
    this.storeFilePath = storeFilePath;
    this.database = database;
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

    await fs.mkdir(path.dirname(storeFilePath), { recursive: true });

    const database = new Database(storeFilePath);
    JiraStorageRepository.ensureSchema(database);

    let snapshot = JiraStorageRepository.readSnapshotFromDatabase(database);
    if (JiraStorageRepository.isSnapshotEmpty(snapshot)) {
      const raw = await JiraStorageRepository.readRawSnapshot(
        JiraStorageRepository.resolveLegacyStorePath(storeFilePath),
      );
      const migrated = migrateJiraStorageSnapshot(raw);
      if (!JiraStorageRepository.isSnapshotEmpty(migrated)) {
        JiraStorageRepository.writeSnapshotToDatabase(database, migrated);
      }
      snapshot = JiraStorageRepository.readSnapshotFromDatabase(database);
    }

    return new JiraStorageRepository(storeFilePath, database, snapshot);
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

      const statement = this.database.prepare(
        `INSERT INTO issue_links (
            external_key,
            provider,
            cloud_id,
            external_issue_id,
            external_issue_key,
            internal_issue_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(external_key) DO UPDATE SET
            provider = excluded.provider,
            cloud_id = excluded.cloud_id,
            external_issue_id = excluded.external_issue_id,
            external_issue_key = excluded.external_issue_key,
            internal_issue_id = excluded.internal_issue_id,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at`,
      );
      statement.run(
        next.externalKey,
        next.provider,
        next.cloudId,
        next.externalIssueId,
        next.externalIssueKey,
        next.internalIssueId,
        next.createdAt,
        next.updatedAt,
      );
      this.snapshot.externalIssueLinks[externalKey] = next;
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

      this.database
        .prepare(
          `INSERT INTO idempotency (
            idempotency_key,
            external_event_id,
            external_key,
            payload_hash,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          next.idempotencyKey,
          next.externalEventId,
          next.externalKey,
          next.payloadHash,
          next.status,
          next.createdAt,
          next.updatedAt,
        );
      this.snapshot.idempotency[key] = next;
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

      this.database
        .prepare(
          `UPDATE idempotency
          SET status = ?, updated_at = ?
          WHERE idempotency_key = ?`,
        )
        .run(next.status, next.updatedAt, key);
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
        this.database
          .prepare(
            "DELETE FROM idempotency WHERE external_key = ? AND idempotency_key != ?",
          )
          .run(ext, key);
      }

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

      this.database
        .prepare("DELETE FROM event_logs WHERE external_key = ?")
        .run(ticketKey);
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

      this.database
        .prepare(
          `INSERT INTO event_logs (
            log_key,
            external_event_id,
            external_key,
            event_type,
            status,
            error,
            payload_hash,
            processed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          next.logKey,
          next.externalEventId,
          next.externalKey,
          next.eventType,
          next.status,
          next.error,
          next.payloadHash,
          next.processedAt,
        );
      this.snapshot.eventLogs[ticketKey] = next;
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

  private static ensureSchema(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS issue_links (
        external_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        cloud_id TEXT NOT NULL,
        external_issue_id TEXT NOT NULL,
        external_issue_key TEXT,
        internal_issue_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency (
        idempotency_key TEXT PRIMARY KEY,
        external_event_id TEXT,
        external_key TEXT NOT NULL,
        payload_hash TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_logs (
        log_key TEXT PRIMARY KEY,
        external_event_id TEXT,
        external_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        payload_hash TEXT,
        processed_at TEXT NOT NULL
      );
    `);
  }

  private static readSnapshotFromDatabase(
    database: Database.Database,
  ): JiraStorageSnapshot {
    const snapshot = createEmptyJiraStorageSnapshot();

    const issueRows = database
      .prepare(
        `SELECT
          external_key,
          provider,
          cloud_id,
          external_issue_id,
          external_issue_key,
          internal_issue_id,
          created_at,
          updated_at
        FROM issue_links`,
      )
      .all() as Array<{
      external_key: string;
      provider: string;
      cloud_id: string;
      external_issue_id: string;
      external_issue_key: string | null;
      internal_issue_id: string;
      created_at: string;
      updated_at: string;
    }>;
    for (const row of issueRows) {
      snapshot.externalIssueLinks[row.external_key] = {
        provider: "jira",
        externalKey: row.external_key,
        cloudId: row.cloud_id,
        externalIssueId: row.external_issue_id,
        externalIssueKey: row.external_issue_key,
        internalIssueId: row.internal_issue_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    const idempotencyRows = database
      .prepare(
        `SELECT
          idempotency_key,
          external_event_id,
          external_key,
          payload_hash,
          status,
          created_at,
          updated_at
        FROM idempotency`,
      )
      .all() as Array<{
      idempotency_key: string;
      external_event_id: string | null;
      external_key: string;
      payload_hash: string | null;
      status: JiraIdempotencyRecord["status"];
      created_at: string;
      updated_at: string;
    }>;
    for (const row of idempotencyRows) {
      snapshot.idempotency[row.idempotency_key] = {
        idempotencyKey: row.idempotency_key,
        externalEventId: row.external_event_id,
        externalKey: row.external_key,
        payloadHash: row.payload_hash,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    const eventRows = database
      .prepare(
        `SELECT
          log_key,
          external_event_id,
          external_key,
          event_type,
          status,
          error,
          payload_hash,
          processed_at
        FROM event_logs`,
      )
      .all() as Array<{
      log_key: string;
      external_event_id: string | null;
      external_key: string;
      event_type: string;
      status: JiraIntegrationEventLog["status"];
      error: string | null;
      payload_hash: string | null;
      processed_at: string;
    }>;
    for (const row of eventRows) {
      snapshot.eventLogs[row.log_key] = {
        logKey: row.log_key,
        externalEventId: row.external_event_id,
        externalKey: row.external_key,
        eventType: row.event_type,
        status: row.status,
        error: row.error,
        payloadHash: row.payload_hash,
        processedAt: row.processed_at,
      };
    }

    return snapshot;
  }

  private static writeSnapshotToDatabase(
    database: Database.Database,
    snapshot: JiraStorageSnapshot,
  ): void {
    const transaction = database.transaction((input: JiraStorageSnapshot) => {
      database.exec("DELETE FROM issue_links; DELETE FROM idempotency; DELETE FROM event_logs;");

      const insertIssue = database.prepare(
        `INSERT INTO issue_links (
          external_key,
          provider,
          cloud_id,
          external_issue_id,
          external_issue_key,
          internal_issue_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const link of Object.values(input.externalIssueLinks)) {
        insertIssue.run(
          link.externalKey,
          link.provider,
          link.cloudId,
          link.externalIssueId,
          link.externalIssueKey,
          link.internalIssueId,
          link.createdAt,
          link.updatedAt,
        );
      }

      const insertIdempotency = database.prepare(
        `INSERT INTO idempotency (
          idempotency_key,
          external_event_id,
          external_key,
          payload_hash,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const record of Object.values(input.idempotency)) {
        insertIdempotency.run(
          record.idempotencyKey,
          record.externalEventId,
          record.externalKey,
          record.payloadHash,
          record.status,
          record.createdAt,
          record.updatedAt,
        );
      }

      const insertEventLog = database.prepare(
        `INSERT INTO event_logs (
          log_key,
          external_event_id,
          external_key,
          event_type,
          status,
          error,
          payload_hash,
          processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const log of Object.values(input.eventLogs)) {
        insertEventLog.run(
          log.logKey,
          log.externalEventId,
          log.externalKey,
          log.eventType,
          log.status,
          log.error,
          log.payloadHash,
          log.processedAt,
        );
      }
    });

    transaction(snapshot);
  }

  private static isSnapshotEmpty(snapshot: JiraStorageSnapshot): boolean {
    return (
      Object.keys(snapshot.externalIssueLinks).length === 0 &&
      Object.keys(snapshot.idempotency).length === 0 &&
      Object.keys(snapshot.eventLogs).length === 0
    );
  }

  private static resolveLegacyStorePath(storeFilePath: string): string {
    if (storeFilePath.endsWith(".sqlite")) {
      return storeFilePath.slice(0, -".sqlite".length) + ".json";
    }

    if (storeFilePath.endsWith(".db")) {
      return storeFilePath.slice(0, -".db".length) + ".json";
    }

    if (storeFilePath === DEFAULT_STORAGE_FILE) {
      return DEFAULT_LEGACY_STORAGE_FILE;
    }

    return storeFilePath;
  }

  private static async readRawSnapshot(storeFilePath: string): Promise<unknown> {
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
