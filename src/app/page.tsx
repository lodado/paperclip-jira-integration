import { getConsoleAuthConfig } from "@/lib/console-session";

import { LogoutButton } from "./logout-button";

export default function Home() {
  const auth = getConsoleAuthConfig();

  return (
    <main>
      {auth.enabled ? (
        <p>
          You are signed in to the console. Integration endpoints still use
          their own Bearer tokens.
        </p>
      ) : null}
      <p>
        Jira poll: GET or POST /integrations/jira/poll — optional query{" "}
        <code>jql</code> (extra JQL after <code>updated</code> clause),{" "}
        <code>lookback</code> or <code>lookbackMinutes</code> (1–1440).
        Production needs Bearer (CRON_SECRET or JIRA_POLL_SECRET); local{" "}
        <code>next dev</code> skips poll auth.
      </p>
      <p>
        Jira planner task create: POST /integrations/jira/tasks. Production
        needs Bearer (<code>JIRA_PLANNER_SECRET</code> fallback to{" "}
        <code>CRON_SECRET</code>/<code>JIRA_POLL_SECRET</code>); local{" "}
        <code>next dev</code> skips planner auth.
      </p>
      {auth.enabled ? <LogoutButton /> : null}
    </main>
  );
}
