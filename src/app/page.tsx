export default function Home() {
  return (
    <main>
      <p>
        Jira poll: GET or POST /integrations/jira/poll — optional query{" "}
        <code>jql</code> / <code>extraJql</code> (extra JQL after{" "}
        <code>updated</code> clause). Production needs Bearer (CRON_SECRET or
        JIRA_POLL_SECRET); local <code>next dev</code> skips auth.
      </p>
    </main>
  );
}
