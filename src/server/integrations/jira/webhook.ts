import crypto from "node:crypto";

import { extractPlainTextFromJiraDescriptionField } from "./description-text";

export type JiraWebhookNormalizedEventType = "issue.created" | "issue.updated";

export type JiraWebhookNormalizedIssue = {
  id: string;
  key: string;
  summary: string | null;
  description: string | null;
  priority: string | null;
  status: string | null;
  issueType: string | null;
  projectId: string | null;
  projectKey: string | null;
  url: string | null;
};

export type JiraWebhookChange = {
  fieldId: string | null;
  field: string | null;
  from: string | null;
  to: string | null;
  fromString: string | null;
  toString: string | null;
};

export type JiraWebhookNormalizedEvent = {
  provider: "jira";
  eventType: JiraWebhookNormalizedEventType;
  externalEventId: string | null;
  timestamp: number | null;
  issue: JiraWebhookNormalizedIssue;
  changes: JiraWebhookChange[];
};

type JiraWebhookPayload = {
  timestamp?: unknown;
  webhookEvent?: unknown;
  issue_event_type_name?: unknown;
  issue?: {
    id?: unknown;
    key?: unknown;
    self?: unknown;
    fields?: {
      summary?: unknown;
      description?: unknown;
      priority?: { name?: unknown };
      status?: { name?: unknown };
      issuetype?: { name?: unknown };
      project?: { id?: unknown; key?: unknown };
    };
  };
  changelog?: {
    items?: Array<{
      fieldId?: unknown;
      field?: unknown;
      from?: unknown;
      to?: unknown;
      fromString?: unknown;
      toString?: unknown;
    }>;
  };
};

const SUPPORTED_WEBHOOK_EVENTS: Record<string, JiraWebhookNormalizedEventType> =
  {
    "jira:issue_created": "issue.created",
    "jira:issue_updated": "issue.updated",
  };

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isSupportedJiraWebhookEvent(
  payload: JiraWebhookPayload,
): boolean {
  const eventName = toStringOrNull(payload.webhookEvent);
  if (!eventName) {
    return false;
  }

  return eventName in SUPPORTED_WEBHOOK_EVENTS;
}

export function normalizeJiraWebhookEvent(
  payload: JiraWebhookPayload,
  headers: Headers,
): JiraWebhookNormalizedEvent {
  const rawEventName = toStringOrNull(payload.webhookEvent);
  if (!rawEventName || !(rawEventName in SUPPORTED_WEBHOOK_EVENTS)) {
    throw new Error("Unsupported Jira webhook event");
  }

  const issue = payload.issue;
  const issueId = toStringOrNull(issue?.id);
  const issueKey = toStringOrNull(issue?.key);

  if (!issueId || !issueKey) {
    throw new Error("Jira webhook payload is missing issue id/key");
  }

  const issueFields = issue?.fields;
  const issueDescription = issueFields?.description;
  const description =
    extractPlainTextFromJiraDescriptionField(issueDescription);

  const changes = Array.isArray(payload.changelog?.items)
    ? payload.changelog.items.map((item) => ({
        fieldId: toStringOrNull(item.fieldId),
        field: toStringOrNull(item.field),
        from: toStringOrNull(item.from),
        to: toStringOrNull(item.to),
        fromString: toStringOrNull(item.fromString),
        toString: toStringOrNull(item.toString),
      }))
    : [];

  return {
    provider: "jira",
    eventType: SUPPORTED_WEBHOOK_EVENTS[rawEventName],
    externalEventId:
      headers.get("x-atlassian-webhook-identifier") ||
      headers.get("x-request-id") ||
      null,
    timestamp: toNumberOrNull(payload.timestamp),
    issue: {
      id: issueId,
      key: issueKey,
      summary: toStringOrNull(issueFields?.summary),
      description,
      priority: toStringOrNull(issueFields?.priority?.name),
      status: toStringOrNull(issueFields?.status?.name),
      issueType: toStringOrNull(issueFields?.issuetype?.name),
      projectId: toStringOrNull(issueFields?.project?.id),
      projectKey: toStringOrNull(issueFields?.project?.key),
      url: toStringOrNull(issue?.self),
    },
    changes,
  };
}

function extractProvidedDigest(signatureHeader: string): string {
  const trimmed = signatureHeader.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.toLowerCase().startsWith("sha256=")) {
    return trimmed.slice("sha256=".length).trim();
  }

  return trimmed;
}

function safeEqualHexDigest(
  expectedHex: string,
  providedDigest: string,
): boolean {
  const normalizedProvided = providedDigest.toLowerCase();
  if (!/^[a-f0-9]+$/.test(normalizedProvided)) {
    return false;
  }

  if (normalizedProvided.length !== expectedHex.length) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedHex, "hex");
  const providedBuffer = Buffer.from(normalizedProvided, "hex");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function safeEqualString(expected: string, provided: string): boolean {
  if (!provided || expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(provided, "utf8"),
  );
}

export function verifyJiraWebhookSignature(params: {
  rawBody: string;
  secret: string;
  signatureHeader: string | null;
}): boolean {
  const { rawBody, secret, signatureHeader } = params;

  if (!signatureHeader) {
    return false;
  }

  const providedDigest = extractProvidedDigest(signatureHeader);
  if (!providedDigest) {
    return false;
  }

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  // Jira deployments vary by header format: support hex and base64 digests.
  return (
    safeEqualHexDigest(expectedHex, providedDigest) ||
    safeEqualString(
      Buffer.from(expectedHex, "hex").toString("base64"),
      providedDigest,
    )
  );
}
