import { NextResponse } from "next/server";

import {
  verifyJiraPollRequest,
  resolvePollBearerSecret,
  isJiraPollDevAuthBypass,
} from "@/server/integrations/jira/poll-auth";
import { parseJiraPollQueryParams } from "@/server/integrations/jira/poll-query";
import { runJiraPoll } from "@/server/integrations/jira/poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePoll(request: Request) {
  const devBypass = isJiraPollDevAuthBypass();

  if (!devBypass) {
    if (!resolvePollBearerSecret()) {
      return NextResponse.json(
        { error: "CRON_SECRET or JIRA_POLL_SECRET is not configured" },
        { status: 500 },
      );
    }

    if (!verifyJiraPollRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const parsed = parseJiraPollQueryParams(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await runJiraPoll({
      ...(parsed.lookbackMinutes !== undefined && {
        lookbackMinutes: parsed.lookbackMinutes,
      }),
      ...(parsed.extraJql !== undefined && { extraJql: parsed.extraJql }),
      ...(parsed.jqlOnly && { jqlOnly: true }),
    });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handlePoll(request);
}

export async function POST(request: Request) {
  return handlePoll(request);
}
