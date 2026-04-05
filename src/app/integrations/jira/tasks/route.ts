import { NextResponse } from "next/server";

import {
  createJiraTask,
  validateCreateJiraTaskInput,
} from "@/server/integrations/jira/create-task";
import {
  isJiraTaskApiDevAuthBypass,
  resolvePlannerBearerSecret,
  verifyJiraPlannerRequest,
} from "@/server/integrations/jira/task-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const devBypass = isJiraTaskApiDevAuthBypass();

  if (!devBypass) {
    if (!resolvePlannerBearerSecret()) {
      return NextResponse.json(
        {
          error:
            "JIRA_PLANNER_SECRET or CRON_SECRET or JIRA_POLL_SECRET is not configured",
        },
        { status: 500 },
      );
    }

    if (!verifyJiraPlannerRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = validateCreateJiraTaskInput(
    (parsedBody || {}) as Record<string, unknown>,
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createJiraTask({ input: parsed.value });
    return NextResponse.json({ ok: true, issue: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 502 },
    );
  }
}
