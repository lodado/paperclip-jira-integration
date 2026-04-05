import { extractPlainTextFromJiraDescriptionField } from "./description-text";
import type { JiraWebhookNormalizedEvent } from "./webhook";
import { processJiraWebhookEvent, type JiraSyncEnvironment } from "./sync";
import { JiraStorageRepository } from "./storage";

export type JiraAtlassianAuth = {
  email: string;
  apiToken: string;
  cloudId: string;
};

export type JiraSearchIssueFields = {
  summary?: unknown;
  description?: unknown;
  priority?: { name?: unknown };
  status?: { name?: unknown };
  issuetype?: { name?: unknown };
  project?: { id?: unknown; key?: unknown };
  updated?: unknown;
};

export type JiraSearchIssue = {
  id: unknown;
  key: unknown;
  self?: unknown;
  fields?: JiraSearchIssueFields;
};

export type JiraSearchResponse = {
  issues?: JiraSearchIssue[];
  /** Jira Cloud enhanced search (`/search/jql`) — absent on last page */
  nextPageToken?: unknown;
  isLast?: unknown;
  total?: unknown;
  startAt?: unknown;
  maxResults?: unknown;
};

export type RunJiraPollOptions = {
  repository?: JiraStorageRepository;
  environment?: JiraSyncEnvironment;
  fetchImpl?: typeof fetch;
  auth?: JiraAtlassianAuth;
  extraJql?: string;
};

/** JQL `updated >= -Nm`; fixed overlap vs ~5m cron (not configurable). */
const POLL_LOOKBACK_MINUTES = 10;

export type JiraPollItemResult =
  | { issueKey: string; ok: true; outcome: string; reason: string }
  | { issueKey: string; ok: false; error: string };

export type RunJiraPollResult = {
  scanned: number;
  results: JiraPollItemResult[];
};

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function resolveJiraAtlassianAuth(): JiraAtlassianAuth {
  const email =
    process.env.JIRA_ATLASSIAN_EMAIL?.trim() ||
    process.env.ATLASSIAN_EMAIL?.trim();
  const apiToken =
    process.env.JIRA_ATLASSIAN_API_TOKEN?.trim() ||
    process.env.JIRA_API_TOKEN?.trim();
  const cloudId = process.env.JIRA_CLOUD_ID?.trim();

  if (!email) {
    throw new Error(
      "JIRA_ATLASSIAN_EMAIL or ATLASSIAN_EMAIL is required for Jira polling",
    );
  }

  if (!apiToken) {
    throw new Error(
      "JIRA_ATLASSIAN_API_TOKEN or JIRA_API_TOKEN is required for Jira polling",
    );
  }

  if (!cloudId) {
    throw new Error("JIRA_CLOUD_ID is required for Jira polling");
  }

  return { email, apiToken, cloudId };
}

function basicAuthorizationHeader(auth: JiraAtlassianAuth): string {
  const raw = `${auth.email}:${auth.apiToken}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function buildSearchJql(
  lookbackMinutes: number,
  extraJql: string | undefined,
): string {
  const timeClause = `updated >= -${lookbackMinutes}m`;
  const trimmedExtra = extraJql?.trim();
  if (!trimmedExtra) {
    return timeClause;
  }

  return `${timeClause} ${trimmedExtra}`;
}

export function jiraSearchIssueToNormalizedEvent(
  issue: JiraSearchIssue,
  cloudId: string,
): JiraWebhookNormalizedEvent {
  const issueId = toStringOrNull(issue.id);
  const issueKey = toStringOrNull(issue.key);
  if (!issueId || !issueKey) {
    throw new Error("Jira search issue is missing id or key");
  }

  const f = issue.fields || {};
  const description = extractPlainTextFromJiraDescriptionField(f.description);

  const updatedRaw = toStringOrNull(f.updated) || "";

  return {
    provider: "jira",
    eventType: "issue.updated",
    externalEventId: `poll:${cloudId.trim()}:${issueId}:${updatedRaw}`,
    timestamp: updatedRaw ? Date.parse(updatedRaw) || null : null,
    issue: {
      id: issueId,
      key: issueKey,
      summary: toStringOrNull(f.summary),
      description,
      priority: toStringOrNull(f.priority?.name),
      status: toStringOrNull(f.status?.name),
      issueType: toStringOrNull(f.issuetype?.name),
      projectId: toStringOrNull(f.project?.id),
      projectKey: toStringOrNull(f.project?.key),
      url: toStringOrNull(issue.self),
    },
    changes: [],
  };
}

async function postJiraSearch(
  auth: JiraAtlassianAuth,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<JiraSearchResponse> {
  const url = `https://api.atlassian.com/ex/jira/${encodeURIComponent(
    auth.cloudId,
  )}/rest/api/3/search/jql`;

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: basicAuthorizationHeader(auth),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Jira search failed (${response.status}): ${text || "unknown"}`,
    );
  }

  return (await response.json()) as JiraSearchResponse;
}

const SEARCH_FIELDS = [
  "summary",
  "description",
  "priority",
  "status",
  "issuetype",
  "project",
  "updated",
];

function nextPageTokenFromResponse(page: JiraSearchResponse): string | null {
  const t = page.nextPageToken;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

async function fetchAllIssuesMatchingJql(
  auth: JiraAtlassianAuth,
  jql: string,
  fetchImpl: typeof fetch,
): Promise<JiraSearchIssue[]> {
  const collected: JiraSearchIssue[] = [];
  const maxResults = 50;
  let nextPageToken: string | null = null;
  let pageCount = 0;
  const maxPages = 500;

  while (pageCount < maxPages) {
    pageCount += 1;
    const body: Record<string, unknown> = {
      jql,
      fields: SEARCH_FIELDS,
      maxResults,
    };
    if (nextPageToken) {
      body.nextPageToken = nextPageToken;
    }

    const page = await postJiraSearch(auth, body, fetchImpl);

    const issues = Array.isArray(page.issues) ? page.issues : [];
    collected.push(...issues);

    if (page.isLast === true || issues.length === 0) {
      break;
    }

    const token = nextPageTokenFromResponse(page);
    if (!token) {
      break;
    }
    nextPageToken = token;
  }

  return collected;
}

export async function runJiraPoll(
  options: RunJiraPollOptions = {},
): Promise<RunJiraPollResult> {
  const auth = options.auth || resolveJiraAtlassianAuth();
  const fetchImpl = options.fetchImpl || fetch;
  const extraJql =
    options.extraJql?.trim() || process.env.JIRA_POLL_JQL?.trim() || undefined;

  const jql = buildSearchJql(POLL_LOOKBACK_MINUTES, extraJql);
  const issues = await fetchAllIssuesMatchingJql(auth, jql, fetchImpl);

  const repository =
    options.repository || (await JiraStorageRepository.create());
  const environment = options.environment;

  const results: JiraPollItemResult[] = [];

  for (const issue of issues) {
    const issueKey = toStringOrNull(issue.key) || "?";
    try {
      const event = jiraSearchIssueToNormalizedEvent(issue, auth.cloudId);
      const rawBody = JSON.stringify({
        source: "jira-poll",
        cloudId: auth.cloudId,
        issueId: event.issue.id,
        issueKey: event.issue.key,
        updated: issue.fields?.updated,
      });

      const result = await processJiraWebhookEvent({
        event,
        rawBody,
        repository,
        environment,
      });

      results.push({
        issueKey,
        ok: true,
        outcome: result.outcome,
        reason: result.reason,
      });
    } catch (error) {
      results.push({
        issueKey,
        ok: false,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return { scanned: issues.length, results };
}
