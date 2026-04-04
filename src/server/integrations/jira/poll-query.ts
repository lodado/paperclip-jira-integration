export type PollQueryParseResult =
  | { ok: true; lookbackMinutes?: number; extraJql?: string }
  | { ok: false; error: string };

const LOOKBACK_MIN = 1;
const LOOKBACK_MAX = 1440;

/**
 * Optional GET/POST query overrides for `/integrations/jira/poll`.
 * When a param is absent or empty, `runJiraPoll` falls back to env (`JIRA_POLL_*`).
 */
export function parseJiraPollQueryParams(
  searchParams: URLSearchParams,
): PollQueryParseResult {
  const lookbackRaw =
    searchParams.get("lookbackMinutes") ?? searchParams.get("lookback");

  let lookbackMinutes: number | undefined;
  if (lookbackRaw != null && lookbackRaw.trim() !== "") {
    const n = Number.parseInt(lookbackRaw.trim(), 10);
    if (!Number.isFinite(n) || n < LOOKBACK_MIN || n > LOOKBACK_MAX) {
      return {
        ok: false,
        error: `lookback / lookbackMinutes must be an integer ${LOOKBACK_MIN}–${LOOKBACK_MAX}`,
      };
    }
    lookbackMinutes = n;
  }

  const jqlRaw =
    searchParams.get("jql") ?? searchParams.get("extraJql") ?? undefined;
  const extraJql =
    jqlRaw != null && jqlRaw.trim() !== "" ? jqlRaw.trim() : undefined;

  return { ok: true, lookbackMinutes, extraJql };
}
