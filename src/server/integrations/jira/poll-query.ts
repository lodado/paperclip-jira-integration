export type PollQueryParseResult = {
  extraJql?: string;
};

/**
 * Optional GET/POST query overrides for `/integrations/jira/poll`.
 * When absent, `runJiraPoll` uses env `JIRA_POLL_JQL` only (lookback is fixed in code).
 */
export function parseJiraPollQueryParams(
  searchParams: URLSearchParams,
): PollQueryParseResult {
  const jqlRaw =
    searchParams.get("jql") ?? searchParams.get("extraJql") ?? undefined;
  const extraJql =
    jqlRaw != null && jqlRaw.trim() !== "" ? jqlRaw.trim() : undefined;

  return { extraJql };
}
