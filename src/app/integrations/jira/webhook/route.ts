import { NextResponse } from "next/server";

import {
  isSupportedJiraWebhookEvent,
  normalizeJiraWebhookEvent,
  type JiraWebhookNormalizedEvent,
  verifyJiraWebhookSignature,
} from "@/server/integrations/jira/webhook";
import { processJiraWebhookEvent } from "@/server/integrations/jira/sync";

export const runtime = "nodejs";

type RequestLikeJson = Record<string, unknown>;

export async function POST(request: Request) {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "JIRA_WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get("x-hub-signature-256") ||
    request.headers.get("x-hub-signature") ||
    request.headers.get("x-atlassian-webhook-signature");

  if (
    !verifyJiraWebhookSignature({
      rawBody,
      secret,
      signatureHeader,
    })
  ) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 }
    );
  }

  let payload: RequestLikeJson;
  try {
    payload = JSON.parse(rawBody) as RequestLikeJson;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isSupportedJiraWebhookEvent(payload)) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 202 });
  }

  let event: JiraWebhookNormalizedEvent;
  try {
    event = normalizeJiraWebhookEvent(payload, request.headers);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid Jira webhook payload",
        detail: error instanceof Error ? error.message : "unknown",
      },
      { status: 400 }
    );
  }

  try {
    const result = await processJiraWebhookEvent({
      event,
      rawBody,
    });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to process Jira webhook event",
        detail: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 }
    );
  }
}
