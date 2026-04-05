export type JiraPlannerSpecSections = {
  objective?: string;
  context?: string;
  inScope?: string[];
  outOfScope?: string[];
  acceptanceCriteria?: string[];
  technicalNotes?: string[];
  verification?: string[];
  ownerNextAction?: string;
};

export type CreateJiraTaskInput = {
  summary: string;
  requirements?: string;
  projectKey?: string;
  issueType?: string;
  labels?: string[];
  spec?: JiraPlannerSpecSections;
};

export type JiraCreateTaskEnvironment = {
  email: string;
  apiToken: string;
  cloudId: string;
  defaultProjectKey: string | null;
  defaultIssueType: string;
  apiBaseUrl: string;
};

export type JiraTaskCreateResult = {
  id: string;
  key: string;
  url: string | null;
};

type JiraCreateIssueResponse = {
  id?: unknown;
  key?: unknown;
  self?: unknown;
};

type JiraAdfNode = {
  type: "paragraph" | "heading" | "bulletList" | "listItem";
  attrs?: { level?: number };
  content?: JiraAdfNode[] | { type: "text"; text: string }[];
};

type JiraAdfDocument = {
  version: 1;
  type: "doc";
  content: JiraAdfNode[];
};

function toTrimmed(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = toTrimmed(value);
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }

  return out;
}

export function resolveJiraCreateTaskEnvironment(): JiraCreateTaskEnvironment {
  const email =
    process.env.JIRA_ATLASSIAN_EMAIL?.trim() ||
    process.env.ATLASSIAN_EMAIL?.trim();
  const apiToken =
    process.env.JIRA_ATLASSIAN_API_TOKEN?.trim() ||
    process.env.JIRA_API_TOKEN?.trim();
  const cloudId = process.env.JIRA_CLOUD_ID?.trim();

  if (!email) {
    throw new Error("JIRA_ATLASSIAN_EMAIL or ATLASSIAN_EMAIL is required");
  }
  if (!apiToken) {
    throw new Error(
      "JIRA_ATLASSIAN_API_TOKEN or JIRA_API_TOKEN is required",
    );
  }
  if (!cloudId) {
    throw new Error("JIRA_CLOUD_ID is required");
  }

  const defaultProjectKey =
    process.env.JIRA_PLANNER_DEFAULT_PROJECT_KEY?.trim() || null;
  const defaultIssueType =
    process.env.JIRA_PLANNER_DEFAULT_ISSUE_TYPE?.trim() || "Task";

  const apiBaseUrl = (
    process.env.JIRA_ATLASSIAN_API_BASE_URL?.trim() ||
    "https://api.atlassian.com"
  ).replace(/\/+$/, "");

  return {
    email,
    apiToken,
    cloudId,
    defaultProjectKey,
    defaultIssueType,
    apiBaseUrl,
  };
}

function basicAuthorizationHeader(params: {
  email: string;
  apiToken: string;
}): string {
  const raw = `${params.email}:${params.apiToken}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function paragraph(text: string): JiraAdfNode {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function heading(level: 2 | 3, text: string): JiraAdfNode {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function bullet(items: string[]): JiraAdfNode {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraph(item)],
    })),
  };
}

export function buildPlannerDescriptionAdf(
  input: CreateJiraTaskInput,
): JiraAdfDocument {
  const content: JiraAdfNode[] = [];

  const requirements = toTrimmed(input.requirements);
  const objective = toTrimmed(input.spec?.objective) || input.summary.trim();
  const context = toTrimmed(input.spec?.context);
  const inScope = uniqueNonEmpty(input.spec?.inScope);
  const outOfScope = uniqueNonEmpty(input.spec?.outOfScope);
  const acceptance = uniqueNonEmpty(input.spec?.acceptanceCriteria);
  const technical = uniqueNonEmpty(input.spec?.technicalNotes);
  const verification = uniqueNonEmpty(input.spec?.verification);
  const ownerNextAction = toTrimmed(input.spec?.ownerNextAction);

  content.push(heading(2, "Objective"), paragraph(objective));

  if (context || requirements) {
    content.push(heading(2, "Context"));
    if (context) {
      content.push(paragraph(context));
    }
    if (requirements) {
      content.push(heading(3, "Raw Requirements"), paragraph(requirements));
    }
  }

  if (inScope.length) {
    content.push(heading(2, "In Scope"), bullet(inScope));
  }

  if (outOfScope.length) {
    content.push(heading(2, "Out of Scope"), bullet(outOfScope));
  }

  if (acceptance.length) {
    content.push(heading(2, "Acceptance Criteria"), bullet(acceptance));
  }

  if (technical.length) {
    content.push(heading(2, "Technical Notes"), bullet(technical));
  }

  if (verification.length) {
    content.push(heading(2, "Verification"), bullet(verification));
  }

  if (ownerNextAction) {
    content.push(heading(2, "Owner Next Action"), paragraph(ownerNextAction));
  }

  return {
    version: 1,
    type: "doc",
    content,
  };
}

export function validateCreateJiraTaskInput(
  input: Partial<CreateJiraTaskInput>,
): { ok: true; value: CreateJiraTaskInput } | { ok: false; error: string } {
  const summary = toTrimmed(input.summary);
  if (!summary) {
    return { ok: false, error: "summary is required" };
  }
  if (summary.length < 3 || summary.length > 255) {
    return {
      ok: false,
      error: "summary length must be between 3 and 255 characters",
    };
  }

  return {
    ok: true,
    value: {
      summary,
      requirements: toTrimmed(input.requirements) || undefined,
      projectKey: toTrimmed(input.projectKey) || undefined,
      issueType: toTrimmed(input.issueType) || undefined,
      labels: uniqueNonEmpty(input.labels),
      spec: {
        objective: toTrimmed(input.spec?.objective) || undefined,
        context: toTrimmed(input.spec?.context) || undefined,
        inScope: uniqueNonEmpty(input.spec?.inScope),
        outOfScope: uniqueNonEmpty(input.spec?.outOfScope),
        acceptanceCriteria: uniqueNonEmpty(input.spec?.acceptanceCriteria),
        technicalNotes: uniqueNonEmpty(input.spec?.technicalNotes),
        verification: uniqueNonEmpty(input.spec?.verification),
        ownerNextAction: toTrimmed(input.spec?.ownerNextAction) || undefined,
      },
    },
  };
}

export async function createJiraTask(params: {
  input: CreateJiraTaskInput;
  environment?: JiraCreateTaskEnvironment;
  fetchImpl?: typeof fetch;
}): Promise<JiraTaskCreateResult> {
  const environment = params.environment || resolveJiraCreateTaskEnvironment();
  const fetchImpl = params.fetchImpl || fetch;

  const projectKey = params.input.projectKey || environment.defaultProjectKey;
  if (!projectKey) {
    throw new Error(
      "projectKey is required (payload.projectKey or JIRA_PLANNER_DEFAULT_PROJECT_KEY)",
    );
  }

  const payload: Record<string, unknown> = {
    fields: {
      project: { key: projectKey },
      issuetype: { name: params.input.issueType || environment.defaultIssueType },
      summary: params.input.summary,
      description: buildPlannerDescriptionAdf(params.input),
      ...(params.input.labels?.length ? { labels: params.input.labels } : {}),
    },
  };

  const url = `${environment.apiBaseUrl}/ex/jira/${encodeURIComponent(environment.cloudId)}/rest/api/3/issue`;

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: basicAuthorizationHeader(environment),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Jira issue create failed (${response.status}): ${text || "unknown"}`,
    );
  }

  const body = (await response.json()) as JiraCreateIssueResponse;
  const id = toTrimmed(body.id);
  const key = toTrimmed(body.key);

  if (!id || !key) {
    throw new Error("Jira issue create response missing id/key");
  }

  const self = toTrimmed(body.self);

  return { id, key, url: self };
}
