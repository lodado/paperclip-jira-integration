export type PollQueryParseResult =
  | { ok: true; lookbackMinutes?: number; extraJql?: string; jqlOnly?: true }
  | { ok: false; error: string };

const LOOKBACK_MIN = 1;
const LOOKBACK_MAX = 1440;

function parseTruthyParam(raw: string | null): boolean {
  if (raw == null || raw.trim() === "") {
    return false;
  }
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Optional GET/POST query overrides for `/integrations/jira/poll`.
 * When a param is absent or empty, `runJiraPoll` falls back to env (`JIRA_POLL_*`).
 *
 * `jqlOnly=1` (alias `fullJql=1`): use `jql` / `extraJql` as the **entire** JQL string
 * (no `updated >= -Xm` prefix). Required for one-shot “all To Do” style syncs.
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

  const jqlOnly = parseTruthyParam(
    searchParams.get("jqlOnly") ?? searchParams.get("fullJql"),
  );

  if (jqlOnly && !extraJql) {
    return {
      ok: false,
      error:
        "jqlOnly=1 requires a non-empty jql or extraJql (full JQL, no updated prefix)",
    };
  }

  return {
    ok: true,
    lookbackMinutes,
    extraJql,
    ...(jqlOnly ? { jqlOnly: true as const } : {}),
  };
}
