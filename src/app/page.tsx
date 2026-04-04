export default function Home() {
  return (
    <main>
      <p>Jira webhook: POST /integrations/jira/webhook</p>
      <p>
        Jira poll: GET or POST /integrations/jira/poll (Bearer CRON_SECRET or
        JIRA_POLL_SECRET)
      </p>
    </main>
  );
}
