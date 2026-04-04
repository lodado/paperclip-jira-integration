import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  isSupportedJiraWebhookEvent,
  normalizeJiraWebhookEvent,
  verifyJiraWebhookSignature,
} from "../webhook";

describe("verifyJiraWebhookSignature", () => {
  const secret = "test-secret";
  const rawBody = JSON.stringify({ webhookEvent: "jira:issue_created" });

  it("verifies sha256 hex signatures", () => {
    const digest = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("hex");

    expect(
      verifyJiraWebhookSignature({
        rawBody,
        secret,
        signatureHeader: `sha256=${digest}`,
      })
    ).toBe(true);
  });

  it("verifies base64 signatures", () => {
    const digest = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    expect(
      verifyJiraWebhookSignature({
        rawBody,
        secret,
        signatureHeader: digest,
      })
    ).toBe(true);
  });

  it("rejects invalid signatures", () => {
    expect(
      verifyJiraWebhookSignature({
        rawBody,
        secret,
        signatureHeader: "sha256=deadbeef",
      })
    ).toBe(false);
  });
});

describe("normalizeJiraWebhookEvent", () => {
  it("normalizes issue created payload", () => {
    const payload = {
      webhookEvent: "jira:issue_created",
      timestamp: 1710000000000,
      issue: {
        id: "10001",
        key: "PROJ-12",
        self: "https://jira.example/rest/api/3/issue/10001",
        fields: {
          summary: "Create webhook route",
          description: { type: "doc", version: 1 },
          priority: { name: "High" },
          status: { name: "To Do" },
          issuetype: { name: "Task" },
          project: { id: "20001", key: "PROJ" },
        },
      },
    };

    const headers = new Headers({
      "x-atlassian-webhook-identifier": "evt-123",
    });

    expect(isSupportedJiraWebhookEvent(payload)).toBe(true);

    const normalized = normalizeJiraWebhookEvent(payload, headers);

    expect(normalized.provider).toBe("jira");
    expect(normalized.eventType).toBe("issue.created");
    expect(normalized.externalEventId).toBe("evt-123");
    expect(normalized.issue).toEqual({
      id: "10001",
      key: "PROJ-12",
      summary: "Create webhook route",
      description: JSON.stringify({ type: "doc", version: 1 }),
      priority: "High",
      status: "To Do",
      issueType: "Task",
      projectId: "20001",
      projectKey: "PROJ",
      url: "https://jira.example/rest/api/3/issue/10001",
    });
    expect(normalized.changes).toEqual([]);
  });

  it("normalizes issue updated changelog", () => {
    const payload = {
      webhookEvent: "jira:issue_updated",
      issue: {
        id: "10002",
        key: "PROJ-99",
        fields: {},
      },
      changelog: {
        items: [
          {
            fieldId: "status",
            field: "status",
            from: "10000",
            to: "10001",
            fromString: "To Do",
            toString: "In Progress",
          },
        ],
      },
    };

    const normalized = normalizeJiraWebhookEvent(payload, new Headers());

    expect(normalized.eventType).toBe("issue.updated");
    expect(normalized.changes).toEqual([
      {
        fieldId: "status",
        field: "status",
        from: "10000",
        to: "10001",
        fromString: "To Do",
        toString: "In Progress",
      },
    ]);
  });

  it("throws for unsupported events", () => {
    const payload = {
      webhookEvent: "jira:worklog_updated",
      issue: { id: "1", key: "A-1", fields: {} },
    };

    expect(isSupportedJiraWebhookEvent(payload)).toBe(false);

    expect(() => normalizeJiraWebhookEvent(payload, new Headers())).toThrow(
      "Unsupported Jira webhook event"
    );
  });

  it("throws when issue id or key is missing", () => {
    const payload = {
      webhookEvent: "jira:issue_created",
      issue: { id: "1", fields: {} },
    };

    expect(() => normalizeJiraWebhookEvent(payload, new Headers())).toThrow(
      "Jira webhook payload is missing issue id/key"
    );
  });
});
