import crypto from "node:crypto";

import {
  JiraStorageRepository,
  makeJiraExternalKey,
} from "./storage";
import type { JiraWebhookNormalizedEvent } from "./webhook";

type PaperclipIssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

type PaperclipIssuePriority = "critical" | "high" | "medium" | "low";

type JiraProjectMapping = Record<string, string>;

export type JiraSyncEnvironment = {
  apiUrl: string;
  apiKey: string;
  companyId: string;
  cloudId: string;
  defaultProjectId: string | null;
  projectMapping: JiraProjectMapping;
};

export type ProcessJiraWebhookEventInput = {
  event: JiraWebhookNormalizedEvent;
  rawBody: string;
  repository?: JiraStorageRepository;
  environment?: JiraSyncEnvironment;
};

export type ProcessJiraWebhookEventResult = {
  outcome: "processed" | "ignored";
  reason: "created" | "updated" | "duplicate";
  idempotencyKey: string;
  internalIssueId: string | null;
  externalKey: string;
};

type CreateIssuePayload = {
  title: string;
  description: string;
  status?: PaperclipIssueStatus;
  priority?: PaperclipIssuePriority;
  projectId?: string;
};

type UpdateIssuePayload = Partial<CreateIssuePayload>;

type PaperclipIssueResponse = {
  id?: string;
};

const JIRA_PROJECT_MAPPING_ENV = "JIRA_PROJECT_MAPPING_JSON";

function toNormalizedLookupKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase();
}

function parseProjectMapping(raw: string | undefined): JiraProjectMapping {
  if (!raw?.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const mapping: JiraProjectMapping = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const normalizedKey = toNormalizedLookupKey(key);
      if (!normalizedKey || typeof value !== "string" || !value.trim()) {
        continue;
      }

      mapping[normalizedKey] = value.trim();
    }

    return mapping;
  } catch {
    return {};
  }
}

function resolveEnvironment(): JiraSyncEnvironment {
  const apiUrl = process.env.JIRA_PAPERCLIP_API_URL || process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.JIRA_PAPERCLIP_API_KEY || process.env.PAPERCLIP_API_KEY;
  const companyId =
    process.env.JIRA_PAPERCLIP_COMPANY_ID || process.env.PAPERCLIP_COMPANY_ID;
  const cloudId = process.env.JIRA_CLOUD_ID;

  if (!apiUrl?.trim()) {
    throw new Error("JIRA_PAPERCLIP_API_URL or PAPERCLIP_API_URL is required");
  }

  if (!apiKey?.trim()) {
    throw new Error("JIRA_PAPERCLIP_API_KEY or PAPERCLIP_API_KEY is required");
  }

  if (!companyId?.trim()) {
    throw new Error("JIRA_PAPERCLIP_COMPANY_ID or PAPERCLIP_COMPANY_ID is required");
  }

  if (!cloudId?.trim()) {
    throw new Error("JIRA_CLOUD_ID is required");
  }

  return {
    apiUrl: apiUrl.trim().replace(/\/+$/, ""),
    apiKey: apiKey.trim(),
    companyId: companyId.trim(),
    cloudId: cloudId.trim(),
    defaultProjectId: process.env.JIRA_DEFAULT_PROJECT_ID?.trim() || null,
    projectMapping: parseProjectMapping(process.env[JIRA_PROJECT_MAPPING_ENV]),
  };
}

function mapStatus(status: string | null): PaperclipIssueStatus | undefined {
  const normalized = toNormalizedLookupKey(status);
  if (!normalized) {
    return undefined;
  }

  if (["done", "closed", "resolved"].includes(normalized)) {
    return "done";
  }

  if (
    [
      "in progress",
      "in-progress",
      "doing",
      "selected for development",
      "development",
    ].includes(normalized)
  ) {
    return "in_progress";
  }

  if (["to do", "todo", "open", "reopened"].includes(normalized)) {
    return "todo";
  }

  if (["blocked", "on hold"].includes(normalized)) {
    return "blocked";
  }

  if (["review", "in review"].includes(normalized)) {
    return "in_review";
  }

  if (["cancelled", "canceled"].includes(normalized)) {
    return "cancelled";
  }

  return undefined;
}

function mapPriority(priority: string | null): PaperclipIssuePriority | undefined {
  const normalized = toNormalizedLookupKey(priority);
  if (!normalized) {
    return undefined;
  }

  if (normalized === "highest") {
    return "critical";
  }

  if (normalized === "high") {
    return "high";
  }

  if (normalized === "medium") {
    return "medium";
  }

  if (normalized === "low" || normalized === "lowest") {
    return "low";
  }

  return undefined;
}

function mapProjectId(
  params: {
    jiraProjectId: string | null;
    jiraProjectKey: string | null;
  },
  environment: JiraSyncEnvironment
): string | undefined {
  const idLookup = toNormalizedLookupKey(params.jiraProjectId);
  const keyLookup = toNormalizedLookupKey(params.jiraProjectKey);

  if (idLookup && environment.projectMapping[idLookup]) {
    return environment.projectMapping[idLookup];
  }

  if (keyLookup && environment.projectMapping[keyLookup]) {
    return environment.projectMapping[keyLookup];
  }

  return environment.defaultProjectId || undefined;
}

function buildIssueDescription(event: JiraWebhookNormalizedEvent): string {
  const lines = [
    `Synced from Jira issue ${event.issue.key}.`,
    "",
    `- Source: ${event.issue.url || "n/a"}`,
    `- Jira Issue ID: ${event.issue.id}`,
    `- Event Type: ${event.eventType}`,
  ];

  if (event.issue.description) {
    lines.push("", "Jira description:", "", event.issue.description);
  }

  return lines.join("\n");
}

function computePayloadHash(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function resolveIdempotencyKey(event: JiraWebhookNormalizedEvent, payloadHash: string): string {
  const externalEventId = event.externalEventId?.trim();
  if (externalEventId) {
    return `jira:event:${externalEventId}`;
  }

  return `jira:payload:${payloadHash}`;
}

function getChangedFieldSet(event: JiraWebhookNormalizedEvent): Set<string> {
  const changedFields = new Set<string>();
  for (const change of event.changes) {
    const normalizedField = toNormalizedLookupKey(change.field);
    const normalizedFieldId = toNormalizedLookupKey(change.fieldId);

    if (normalizedField) {
      changedFields.add(normalizedField);
    }
    if (normalizedFieldId) {
      changedFields.add(normalizedFieldId);
    }
  }
  return changedFields;
}

function shouldApplyField(changedFields: Set<string>, aliases: string[]): boolean {
  if (changedFields.size === 0) {
    return true;
  }

  return aliases.some((alias) => changedFields.has(alias));
}

async function fetchPaperclipJson<T>(
  environment: JiraSyncEnvironment,
  path: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(`${environment.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${environment.apiKey}`,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Paperclip API ${init.method || "GET"} ${path} failed (${response.status}): ${message || "unknown"}`
    );
  }

  return (await response.json()) as T;
}

function buildCreatePayload(
  event: JiraWebhookNormalizedEvent,
  environment: JiraSyncEnvironment
): CreateIssuePayload {
  const payload: CreateIssuePayload = {
    title: event.issue.summary || event.issue.key,
    description: buildIssueDescription(event),
  };

  const mappedStatus = mapStatus(event.issue.status);
  if (mappedStatus) {
    payload.status = mappedStatus;
  }

  const mappedPriority = mapPriority(event.issue.priority);
  if (mappedPriority) {
    payload.priority = mappedPriority;
  }

  const mappedProjectId = mapProjectId(
    { jiraProjectId: event.issue.projectId, jiraProjectKey: event.issue.projectKey },
    environment
  );
  if (mappedProjectId) {
    payload.projectId = mappedProjectId;
  }

  return payload;
}

function buildUpdatePayload(
  event: JiraWebhookNormalizedEvent,
  environment: JiraSyncEnvironment
): UpdateIssuePayload {
  const changedFields = getChangedFieldSet(event);
  const payload: UpdateIssuePayload = {};

  if (
    shouldApplyField(changedFields, ["summary"]) &&
    (event.issue.summary || event.issue.key)
  ) {
    payload.title = event.issue.summary || event.issue.key;
  }

  if (shouldApplyField(changedFields, ["description"])) {
    payload.description = buildIssueDescription(event);
  }

  if (shouldApplyField(changedFields, ["status"])) {
    const mappedStatus = mapStatus(event.issue.status);
    if (mappedStatus) {
      payload.status = mappedStatus;
    }
  }

  if (shouldApplyField(changedFields, ["priority"])) {
    const mappedPriority = mapPriority(event.issue.priority);
    if (mappedPriority) {
      payload.priority = mappedPriority;
    }
  }

  if (shouldApplyField(changedFields, ["project", "projectid", "projectkey"])) {
    const mappedProjectId = mapProjectId(
      { jiraProjectId: event.issue.projectId, jiraProjectKey: event.issue.projectKey },
      environment
    );
    if (mappedProjectId) {
      payload.projectId = mappedProjectId;
    }
  }

  return payload;
}

async function createPaperclipIssue(
  event: JiraWebhookNormalizedEvent,
  environment: JiraSyncEnvironment
): Promise<string> {
  const body = buildCreatePayload(event, environment);
  const created = await fetchPaperclipJson<PaperclipIssueResponse>(
    environment,
    `/api/companies/${environment.companyId}/issues`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );

  const internalIssueId = created.id?.trim();
  if (!internalIssueId) {
    throw new Error("Paperclip issue create response missing id");
  }

  return internalIssueId;
}

async function updatePaperclipIssue(
  internalIssueId: string,
  event: JiraWebhookNormalizedEvent,
  environment: JiraSyncEnvironment
): Promise<void> {
  const body = buildUpdatePayload(event, environment);
  if (Object.keys(body).length === 0) {
    return;
  }

  await fetchPaperclipJson<PaperclipIssueResponse>(
    environment,
    `/api/issues/${internalIssueId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    }
  );
}

export async function processJiraWebhookEvent(
  input: ProcessJiraWebhookEventInput
): Promise<ProcessJiraWebhookEventResult> {
  const repository = input.repository || (await JiraStorageRepository.create());
  const environment = input.environment || resolveEnvironment();
  const payloadHash = computePayloadHash(input.rawBody);
  const externalKey = makeJiraExternalKey(environment.cloudId, input.event.issue.id);
  const idempotencyKey = resolveIdempotencyKey(input.event, payloadHash);

  const claimed = await repository.claimIdempotencyKey({
    idempotencyKey,
    externalKey,
    externalEventId: input.event.externalEventId,
    payloadHash,
  });

  if (!claimed) {
    await repository.recordEventLog({
      externalEventId: input.event.externalEventId,
      externalKey,
      eventType: input.event.eventType,
      status: "ignored",
      payloadHash,
      error: "duplicate idempotency key",
    });

    return {
      outcome: "ignored",
      reason: "duplicate",
      idempotencyKey,
      internalIssueId: repository.findIssueLinkByExternalKey(externalKey)?.internalIssueId || null,
      externalKey,
    };
  }

  try {
    const existingLink = repository.findIssueLinkByExternalKey(externalKey);

    let internalIssueId: string;
    let reason: ProcessJiraWebhookEventResult["reason"];

    if (input.event.eventType === "issue.created" && !existingLink) {
      internalIssueId = await createPaperclipIssue(input.event, environment);
      reason = "created";
    } else if (existingLink) {
      internalIssueId = existingLink.internalIssueId;
      await updatePaperclipIssue(internalIssueId, input.event, environment);
      reason = "updated";
    } else {
      internalIssueId = await createPaperclipIssue(input.event, environment);
      reason = "created";
    }

    await repository.upsertIssueLink({
      cloudId: environment.cloudId,
      externalIssueId: input.event.issue.id,
      externalIssueKey: input.event.issue.key,
      internalIssueId,
    });

    await repository.markIdempotencyStatus({
      idempotencyKey,
      status: "processed",
    });

    await repository.recordEventLog({
      externalEventId: input.event.externalEventId,
      externalKey,
      eventType: input.event.eventType,
      status: "processed",
      payloadHash,
    });

    return {
      outcome: "processed",
      reason,
      idempotencyKey,
      internalIssueId,
      externalKey,
    };
  } catch (error) {
    await repository.markIdempotencyStatus({
      idempotencyKey,
      status: "failed",
    });

    await repository.recordEventLog({
      externalEventId: input.event.externalEventId,
      externalKey,
      eventType: input.event.eventType,
      status: "failed",
      payloadHash,
      error: error instanceof Error ? error.message : "unknown error",
    });

    throw error;
  }
}
