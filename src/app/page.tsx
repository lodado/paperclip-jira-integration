export default function Home() {
  return (
    <main>
      <p>
        Jira poll: GET or POST /integrations/jira/poll — production needs Bearer
        (CRON_SECRET or JIRA_POLL_SECRET); local <code>next dev</code> skips
        auth.
      </p>
    </main>
  );
}
