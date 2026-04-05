import { defineConfig } from "@playwright/test";

const port = 3000;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    env: {
      JIRA_PLANNER_SECRET: "planner-secret",
      JIRA_ATLASSIAN_EMAIL: "planner@example.com",
      JIRA_ATLASSIAN_API_TOKEN: "token-1",
      JIRA_CLOUD_ID: "cloud-1",
      JIRA_PLANNER_DEFAULT_PROJECT_KEY: "MAY",
      JIRA_ATLASSIAN_API_BASE_URL: "http://127.0.0.1:45679",
    },
  },
});
