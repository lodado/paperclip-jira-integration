export default function Home() {
  return (
    <main>
      <p>
        Jira poll: GET or POST /integrations/jira/poll — optional query{" "}
        <code>jql</code> (extra JQL after <code>updated</code> clause),{" "}
        <code>lookback</code> or <code>lookbackMinutes</code> (1–1440).
        Production needs Bearer (CRON_SECRET or JIRA_POLL_SECRET); local{" "}
        <code>next dev</code> skips auth.
      </p>
    </main>
  );
}
