import { timingSafeEqual } from "node:crypto";

function verifyBearerRequestWithSecret(
  request: Request,
  secret: string | null,
): boolean {
  if (!secret) {
    return false;
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return false;
  }

  const token = header.slice("Bearer ".length);
  if (token.length !== secret.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(token, "utf8"),
      Buffer.from(secret, "utf8"),
    );
  } catch {
    return false;
  }
}

/** `next dev` only — production and `next start` still require Bearer. */
export function isJiraTaskApiDevAuthBypass(): boolean {
  return process.env.NODE_ENV === "development";
}

export function resolvePollBearerSecret(): string | null {
  const fromCron = process.env.CRON_SECRET?.trim();
  const fromPoll = process.env.JIRA_POLL_SECRET?.trim();
  return fromCron || fromPoll || null;
}

export function verifyJiraPollRequest(request: Request): boolean {
  return verifyBearerRequestWithSecret(request, resolvePollBearerSecret());
}

export function resolvePlannerBearerSecret(): string | null {
  const planner = process.env.JIRA_PLANNER_SECRET?.trim();
  const cron = process.env.CRON_SECRET?.trim();
  const poll = process.env.JIRA_POLL_SECRET?.trim();
  return planner || cron || poll || null;
}

export function verifyJiraPlannerRequest(request: Request): boolean {
  return verifyBearerRequestWithSecret(request, resolvePlannerBearerSecret());
}
