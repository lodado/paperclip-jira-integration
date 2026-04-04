import { timingSafeEqual } from "node:crypto";

/** `next dev` only — production and `next start` still require Bearer. */
export function isJiraPollDevAuthBypass(): boolean {
  return process.env.NODE_ENV === "development";
}

export function resolvePollBearerSecret(): string | null {
  const fromCron = process.env.CRON_SECRET?.trim();
  const fromPoll = process.env.JIRA_POLL_SECRET?.trim();
  return fromCron || fromPoll || null;
}

export function verifyJiraPollRequest(request: Request): boolean {
  const secret = resolvePollBearerSecret();
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
