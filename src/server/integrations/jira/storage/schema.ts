export const JIRA_STORAGE_SCHEMA_VERSION = 1;

export type JiraExternalIssueLink = {
  provider: "jira";
  externalKey: string;
  cloudId: string;
  externalIssueId: string;
  externalIssueKey: string | null;
  internalIssueId: string;
  createdAt: string;
  updatedAt: string;
};

export type JiraIdempotencyStatus = "processing" | "processed" | "failed";

export type JiraIdempotencyRecord = {
  idempotencyKey: string;
  externalEventId: string | null;
  externalKey: string;
  payloadHash: string | null;
  status: JiraIdempotencyStatus;
  createdAt: string;
  updatedAt: string;
};

export type JiraIntegrationEventLog = {
  logKey: string;
  externalEventId: string | null;
  externalKey: string;
  eventType: string;
  status: "processed" | "ignored" | "failed";
  error: string | null;
  payloadHash: string | null;
  processedAt: string;
};

export type JiraStorageSnapshot = {
  schemaVersion: typeof JIRA_STORAGE_SCHEMA_VERSION;
  externalIssueLinks: Record<string, JiraExternalIssueLink>;
  idempotency: Record<string, JiraIdempotencyRecord>;
  eventLogs: Record<string, JiraIntegrationEventLog>;
};

type LegacyIssueLink = {
  provider?: unknown;
  externalKey?: unknown;
  cloudId?: unknown;
  externalIssueId?: unknown;
  externalIssueKey?: unknown;
  internalIssueId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type LegacyEventLog = {
  externalEventId?: unknown;
  externalKey?: unknown;
  eventType?: unknown;
  status?: unknown;
  error?: unknown;
  payloadHash?: unknown;
  processedAt?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toStatusOrDefault(value: unknown): JiraIdempotencyStatus {
  if (value === "processed" || value === "failed" || value === "processing") {
    return value;
  }

  return "processing";
}

function toEventStatusOrDefault(
  value: unknown
): JiraIntegrationEventLog["status"] {
  if (value === "processed" || value === "ignored" || value === "failed") {
    return value;
  }

  return "failed";
}

function normalizeIssueLink(
  value: unknown,
  fallbackExternalKey: string
): JiraExternalIssueLink | null {
  if (!isRecord(value)) {
    return null;
  }

  const cloudId = toStringOrNull(value.cloudId);
  const externalIssueId = toStringOrNull(value.externalIssueId);
  const internalIssueId = toStringOrNull(value.internalIssueId);

  if (!cloudId || !externalIssueId || !internalIssueId) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    provider: "jira",
    externalKey: toStringOrNull(value.externalKey) || fallbackExternalKey,
    cloudId,
    externalIssueId,
    externalIssueKey: toStringOrNull(value.externalIssueKey),
    internalIssueId,
    createdAt: toStringOrNull(value.createdAt) || now,
    updatedAt: toStringOrNull(value.updatedAt) || now,
  };
}

function normalizeIdempotency(
  value: unknown,
  fallbackKey: string
): JiraIdempotencyRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const idempotencyKey = toStringOrNull(value.idempotencyKey) || fallbackKey;
  const externalKey = toStringOrNull(value.externalKey);

  if (!externalKey) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    idempotencyKey,
    externalEventId: toStringOrNull(value.externalEventId),
    externalKey,
    payloadHash: toStringOrNull(value.payloadHash),
    status: toStatusOrDefault(value.status),
    createdAt: toStringOrNull(value.createdAt) || now,
    updatedAt: toStringOrNull(value.updatedAt) || now,
  };
}

function normalizeEventLog(
  value: unknown,
  fallbackKey: string
): JiraIntegrationEventLog | null {
  if (!isRecord(value)) {
    return null;
  }

  const externalKey = toStringOrNull(value.externalKey);
  const eventType = toStringOrNull(value.eventType);

  if (!externalKey || !eventType) {
    return null;
  }

  return {
    logKey: toStringOrNull(value.logKey) || fallbackKey,
    externalEventId: toStringOrNull(value.externalEventId),
    externalKey,
    eventType,
    status: toEventStatusOrDefault(value.status),
    error: toStringOrNull(value.error),
    payloadHash: toStringOrNull(value.payloadHash),
    processedAt: toStringOrNull(value.processedAt) || new Date().toISOString(),
  };
}

function migrateLegacyShape(raw: Record<string, unknown>): JiraStorageSnapshot {
  const externalIssueLinks: JiraStorageSnapshot["externalIssueLinks"] = {};

  const legacyLinks = Array.isArray(raw.external_issue_links)
    ? (raw.external_issue_links as LegacyIssueLink[])
    : [];

  for (const entry of legacyLinks) {
    const cloudId = toStringOrNull(entry.cloudId);
    const externalIssueId = toStringOrNull(entry.externalIssueId);
    const externalKey =
      toStringOrNull(entry.externalKey) ||
      (cloudId && externalIssueId ? `jira:${cloudId}:${externalIssueId}` : null);

    if (!externalKey) {
      continue;
    }

    const normalized = normalizeIssueLink(entry, externalKey);
    if (!normalized) {
      continue;
    }

    externalIssueLinks[externalKey] = normalized;
  }

  const eventLogs: JiraStorageSnapshot["eventLogs"] = {};
  const legacyLogs = Array.isArray(raw.integration_event_logs)
    ? (raw.integration_event_logs as LegacyEventLog[])
    : [];

  for (let index = 0; index < legacyLogs.length; index += 1) {
    const entry = legacyLogs[index];
    const logKey =
      toStringOrNull(entry.externalEventId) || `${toStringOrNull(entry.externalKey) || "unknown"}:${index}`;

    const normalized = normalizeEventLog(entry, logKey);
    if (!normalized) {
      continue;
    }

    eventLogs[normalized.logKey] = normalized;
  }

  return {
    schemaVersion: JIRA_STORAGE_SCHEMA_VERSION,
    externalIssueLinks,
    idempotency: {},
    eventLogs,
  };
}

export function createEmptyJiraStorageSnapshot(): JiraStorageSnapshot {
  return {
    schemaVersion: JIRA_STORAGE_SCHEMA_VERSION,
    externalIssueLinks: {},
    idempotency: {},
    eventLogs: {},
  };
}

export function migrateJiraStorageSnapshot(raw: unknown): JiraStorageSnapshot {
  if (!isRecord(raw)) {
    return createEmptyJiraStorageSnapshot();
  }

  if (raw.schemaVersion !== JIRA_STORAGE_SCHEMA_VERSION) {
    return migrateLegacyShape(raw);
  }

  const normalized = createEmptyJiraStorageSnapshot();

  const externalIssueLinks = isRecord(raw.externalIssueLinks)
    ? raw.externalIssueLinks
    : {};
  for (const [externalKey, value] of Object.entries(externalIssueLinks)) {
    const link = normalizeIssueLink(value, externalKey);
    if (link) {
      normalized.externalIssueLinks[externalKey] = link;
    }
  }

  const idempotency = isRecord(raw.idempotency) ? raw.idempotency : {};
  for (const [idempotencyKey, value] of Object.entries(idempotency)) {
    const record = normalizeIdempotency(value, idempotencyKey);
    if (record) {
      normalized.idempotency[idempotencyKey] = record;
    }
  }

  const eventLogs = isRecord(raw.eventLogs) ? raw.eventLogs : {};
  for (const [logKey, value] of Object.entries(eventLogs)) {
    const record = normalizeEventLog(value, logKey);
    if (record) {
      normalized.eventLogs[logKey] = record;
    }
  }

  return normalized;
}
