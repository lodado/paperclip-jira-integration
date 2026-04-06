# FE Issue Engineer — workspace rules

## Why the repo was wrong once

Paperclip/Cursor often opens **`deepconsole-jira-integration`** as `adapterConfig.cwd` because this app is the **Jira ↔ Paperclip bridge**. Many Jira tickets still describe product work for **`@kdl/deep-agent-lab`** (the DEEP Agent web app). That app does **not** live in this repository.

If you only look at `PAPERCLIP_WORKSPACE_CWD` or the bridge repo root, you will **not** find `apps/deep-agent-lab/`, `[locale]/`, or `next-intl` routes here. Those paths belong to the **DeepConsole** monorepo.

## Where to implement

| Ticket / description mentions                                  | Implement here                             | Git root to commit                 |
| -------------------------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| `deep-agent-lab`, `apps/deep-agent-lab`, DEEP Agent product UI | **`DeepConsole/apps/deep-agent-lab`**      | **`DeepConsole`** (e.g. `develop`) |
| Jira polling, planner API, SQLite sync, this Next service only | This repo (`deepconsole-jira-integration`) | This repo                          |

**Default sibling layout (local):** if this repo is `.../deepconsole-jira-integration`, the product app is typically `.../DeepConsole/apps/deep-agent-lab`.

Always read the Paperclip issue **Objective / Worktree** lines: if they still say this bridge path while the spec names `deep-agent-lab`, **follow the spec path on disk**, not the stale worktree line.

## Verification

- **deep-agent-lab:** `cd <DeepConsole>/apps/deep-agent-lab && pnpm build && pnpm test` (and `pnpm test:e2e` when the ticket asks).
- **bridge app:** `cd <this-repo> && pnpm build && pnpm test`.

## Jira Planner API (local)

Paperclip **Jira Planner** creates issues via `POST /integrations/jira/tasks` on this bridge. The dev server URL is not always port 3000—use the base URL your operator gives you (for example `http://localhost:9997`). In `pnpm dev`, Bearer auth may be omitted; in `pnpm start`, send `Authorization: Bearer` using `JIRA_PLANNER_SECRET` (or the documented fallbacks).

A Paperclip issue id like `MAY-1035` is **not** necessarily the Jira `projectKey`. Set `projectKey` from the bridge env (`JIRA_PLANNER_DEFAULT_PROJECT_KEY`) or from the Jira project you intend to file in—do not infer it from the Paperclip identifier prefix alone.

## Paperclip

Use the Paperclip skill: checkout before edits, `X-Paperclip-Run-Id` on mutations, ticket links with the company prefix in comments.
