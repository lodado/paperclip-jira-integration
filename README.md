# paperclip-jira-integration

이 프로젝트는 **Jira Cloud**에 있는 이슈를 주기적으로 읽어 와서, **Paperclip** 쪽에 **같은 일을 하는 이슈**를 만들거나 내용을 맞춰 주는 **Next.js** 서비스입니다. Jira가 “기획·백로그·보드”에 있는 그대로 두고, **에이전트가 돌아가야 하는 작업**은 Paperclip에서 이어가게 하려는 그림에 맞춰져 있어요.

**어떻게 Jira를 읽나요?** Jira **웹훅은 쓰지 않고**, REST API로 **폴링**(일정 주기로 조회)만 합니다. 그래서 Jira 쪽에 웹훅을 깔 필요는 없습니다.

**상태는 어디에 저장하나요?** Jira 이슈와 Paperclip 이슈가 **서로 같은 건지** 알아야 하고, 같은 변경을 **여러 번 처리하지 않도록** 기록이 필요합니다. 그걸 **SQLite 파일 하나**에 둡니다. 기본 경로는 **`.paperclip/integrations/jira-storage.sqlite`** 이고, 바꾸고 싶으면 환경 변수 **`JIRA_STORAGE_FILE`** 로 경로를 지정하면 됩니다. (클라우드에 올릴 때는 **쓰기 가능한 경로**를 꼭 잡아 주세요.)

---

### Paperclip이 뭔가요?

**[Paperclip](https://paperclip.ing)** 은 회사나 팀 단위로 **이슈(할 일)** 와 **AI 에이전트**를 묶어서 운영하는 플랫폼이에요. 이슈에 에이전트를 붙이면, 에이전트는 인박스를 보면서 **체크아웃 → 실행 → 코멘트·상태 정리** 같은 흐름으로 움직입니다. 사람은 UI로 같은 데이터를 볼 수 있고, API로도 다룰 수 있습니다.

### 이 레포는 정확히 뭐 하는 건가요?

- **Jira → Paperclip** 방향만 다룹니다. Jira에서 바뀐 내용을 읽어서 Paperclip 이슈를 **없으면 만들고, 있으면 갱신**합니다.
- **Paperclip → Jira** 로 상태나 코멘트를 **자동으로 되돌려 주지는 않**습니다. Jira 쪽을 맞추려면 사람이 하거나, 다른 자동화를 쓰면 됩니다.

즉, Jira를 없애는 게 아니라 **“티켓의 출처는 Jira, 실행·에이전트 작업은 Paperclip”** 처럼 역할을 나누는 **일방향 연동 브리지**라고 보면 됩니다.

---

## 실행

```bash
pnpm install
cp .env.example .env.local   # 아래 필수 변수 채우기
pnpm dev
```

- 앱: **`http://localhost:9997`** (`pnpm dev` / `pnpm start` 기본 포트)
- 폴링: **`GET` 또는 `POST /integrations/jira/poll`**
- 플래너 이슈 생성: **`POST /integrations/jira/tasks`**
- **배포·`pnpm start`:** `Authorization: Bearer` 토큰 필요. 값은 **`CRON_SECRET`**(있으면 이걸 사용) 또는 **`JIRA_POLL_SECRET`**
- **`pnpm dev`:** Bearer 없이 호출 가능
- URL 쿼리(덮어쓰기용, 생략 가능): `jql`, `extraJql` (`JIRA_POLL_JQL` 대신 한 번만 바꿀 때)

```bash
pnpm test && pnpm type-check && pnpm build && pnpm start
```

---

## 동작 요약

- [Vercel Cron](vercel.json): 프로덕션 배포에 대해 **`GET /integrations/jira/poll`** 를 약 **5분마다**(UTC, `*/5 * * * *`) 호출합니다. Vercel이 도메인으로 요청하므로 **포트는 지정하지 않습니다.** 로컬에서 같은 주기로 돌리려면 아래 crontab 예시처럼 **`http://127.0.0.1:9997`** 을 쓰면 됩니다.
- Jira **`POST /rest/api/3/search/jql`**. 최근 수정 구간은 코드에서 **10분**으로 고정(`updated >= -10m`, Cron 주기와 겹침용). 추가 조건은 `JIRA_POLL_JQL` 또는 요청 쿼리 `jql`.
- 이슈마다 Paperclip `POST`/`PATCH` 후 로컬 SQLite에 기록. 티켓당 멱등·이벤트 로그는 최신 위주로 정리.

---

## curl

```bash
curl -sS -H "Authorization: Bearer $JIRA_POLL_SECRET" \
  https://<배포도메인>/integrations/jira/poll
```

플래너가 Jira task를 생성할 때:

```bash
curl -sS -X POST https://<배포도메인>/integrations/jira/tasks \
  -H "Authorization: Bearer $JIRA_PLANNER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "summary":"로그인 API 명세 작성",
    "requirements":"CTO spec-driven 형식으로 Jira task 생성",
    "spec":{"acceptanceCriteria":["Jira issue가 생성된다"]}
  }'
```

로컬(`pnpm dev`)은 Bearer 없이:

```bash
curl -sS http://localhost:9997/integrations/jira/poll
```

Vercel Cron에는 **`CRON_SECRET`**을 넣으면 요청 Bearer와 맞출 수 있습니다.

로컬에서 **cron**으로 폴링할 때는 **`scripts/jira-poll-local-cron.sh`** 를 쓰는 편이 안전합니다. JQL에 `%`가 들어가는 URL 인코딩을 crontab 한 줄에 넣으면, cron이 `%`를 특수 문자로 잘라 내서 명령이 깨질 수 있습니다. 스크립트는 `curl -G`와 `--data-urlencode`로 평문 JQL을 넘깁니다.

```bash
chmod +x scripts/jira-poll-local-cron.sh
# crontab에는 저장소 절대 경로로 지정
*/5 * * * * /절대/경로/papaclip-jira-kdl/scripts/jira-poll-local-cron.sh
```

**macOS:** 레포가 **Desktop·문서·다운로드** 등 보호 구역 아래에 있으면, `cron`이 스크립트를 실행할 때 **`Operation not permitted`** 로 막히는 경우가 많습니다. (`mail` 또는 `/var/mail/$USER`에 Cron Daemon 메일로 옵니다.)  
**권장:** 스크립트를 Library 쪽으로 복사한 뒤 crontab은 그 경로만 가리키세요.

```bash
sh scripts/install-macos-user-cron.sh
# 출력된 한 줄을 crontab -e 에 붙여 넣기 (레포 경로 대신 Library 경로 사용)
```

대안으로 시스템 설정 → 개인정보 보호 및 보안 → **전체 디스크 접근 권한**에 **`/usr/sbin/cron`** 을 추가하는 방법도 있지만, 복사 방식이 설정이 단순합니다. 스크립트 내용을 바꾼 뒤에는 `install-macos-user-cron.sh` 를 다시 실행해 복사본을 갱신하세요.

JQL·URL·로그 경로는 환경 변수로 바꿀 수 있습니다(`.env.example` 주석 참고): `JIRA_POLL_CRON_JQL`, `JIRA_POLL_CRON_BASE_URL`, `JIRA_POLL_CRON_LOG`. cron 환경에는 `.env.local`이 자동으로 안 잡히므로, 필요하면 crontab 상단에 `JIRA_POLL_CRON_JQL=...` 처럼 넣거나 래퍼에서 `export` 하면 됩니다.

`pnpm start`로 띄운 뒤 돌릴 때는 **`JIRA_POLL_SECRET`** 또는 **`CRON_SECRET`** 을 스크립트 환경에 넣어야 합니다. `pnpm dev`는 poll Bearer를 생략해도 됩니다.

한 줄 `curl` 예시(쿼리에 `%`가 없을 때만):

```bash
*/5 * * * * /usr/bin/curl -fsS -H "Authorization: Bearer $JIRA_POLL_SECRET" http://127.0.0.1:9997/integrations/jira/poll >/dev/null
```

---

## 환경 변수

표에는 **권장 이름(`JIRA_*`)만** 적습니다. `PAPERCLIP_*`, `ATLASSIAN_EMAIL` 등 **짧은 이름**도 코드에서 읽습니다. 둘 다 있으면 **`JIRA_*`가 우선**입니다. 전체 목록은 **`.env.example`** 주석을 보면 됩니다.

### 필수

| 변수                                  | 용도                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| `JIRA_ATLASSIAN_EMAIL`                | Jira Basic 이메일                                          |
| `JIRA_ATLASSIAN_API_TOKEN`            | Jira API 토큰                                              |
| `JIRA_CLOUD_ID`                       | Atlassian cloud ID                                         |
| `JIRA_PAPERCLIP_API_URL`              | Paperclip API 베이스 URL                                   |
| `JIRA_PAPERCLIP_API_KEY`              | Paperclip API 키(Bearer)                                   |
| `JIRA_PAPERCLIP_COMPANY_ID`           | Paperclip 회사 ID                                          |
| `CRON_SECRET` 또는 `JIRA_POLL_SECRET` | 배포/프로덕션 폴링 Bearer(둘 다 있으면 `CRON_SECRET` 사용) |

### 선택

안 넣어도 됩니다. **기본값으로 돌아가고**, 필요할 때만 채우면 됩니다.

| 변수                                              | 이렇게 쓰면 됩니다                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JIRA_POLL_JQL`                                   | 검색 JQL에서 **`updated >= -10m` 뒤에** 이어 붙는 조각입니다. 예: `AND project = KAN`처럼 특정 프로젝트만 볼 때. 비우면 **전체 프로젝트** 중 최근 **10분** 안에 수정된 이슈만 가져옵니다.                                                        |
| `JIRA_DEFAULT_PROJECT_ID`                         | Paperclip에 새 이슈를 넣을 때 `projectId`를 어떻게 정할지 모호할 때 쓰는 **기본값**입니다. Jira 프로젝트별로 다르게 쓰려면 아래 매핑을 쓰는 편이 좋습니다.                                                                                       |
| `JIRA_PROJECT_MAPPING_JSON`                       | **Jira 프로젝트(id 또는 key)** → **Paperclip `projectId`** 를 JSON으로 적습니다. 팀마다 Jira 프로젝트가 여러 개일 때, Paperclip 쪽 프로젝트를 맞춰 두려면 여기서 매핑하면 됩니다.                                                                |
| `JIRA_PAPERCLIP_NEW_ISSUE_ASSIGNEE_AGENT_ID`      | Jira에서 **처음** Paperclip으로 넘어온 이슈에만, 지정한 에이전트를 **담당으로 붙일 때** 씁니다. 이미 있는 이슈 갱신에는 영향 없습니다.                                                                                                           |
| `JIRA_PAPERCLIP_NEW_ISSUE_ASSIGNEE_AGENT_URL_KEY` | 위 ID를 모를 때, Paperclip API로 에이전트 목록을 받아와 **`urlKey`가 같은 에이전트**를 찾습니다. **안 적으면** 기본으로 `jira-controller`를 찾습니다. **빈 문자열 `""`로 두면** 이 검색 자체를 하지 않습니다(에이전트 자동 배정이 필요 없을 때). |
| `JIRA_STORAGE_FILE`                               | Jira↔Paperclip 연동 상태(매핑·멱등 등)를 저장하는 **SQLite 파일 경로**입니다. Vercel 같은 서버리스에서는 기본 경로가 쓰기 불가할 수 있어서, **쓰기 가능한 경로**를 꼭 지정해 주세요.                                                             |
| `JIRA_PLANNER_SECRET`                             | `POST /integrations/jira/tasks` 인증 Bearer입니다. 없으면 `CRON_SECRET` → `JIRA_POLL_SECRET` 순서로 fallback 합니다.                                                                                                                             |
| `JIRA_PLANNER_DEFAULT_PROJECT_KEY`                | planner payload에 `projectKey`가 없을 때 Jira 이슈를 생성할 기본 프로젝트 key입니다.                                                                                                                                                             |
| `JIRA_PLANNER_DEFAULT_ISSUE_TYPE`                 | planner payload에 `issueType`이 없을 때 Jira 이슈 타입 기본값입니다(기본 `Task`).                                                                                                                                                                |
| `JIRA_ATLASSIAN_API_BASE_URL`                     | Atlassian API 베이스 URL override입니다(기본 `https://api.atlassian.com`). 로컬 E2E mock에서 사용합니다.                                                                                                                                         |

---

## 폴링 응답

| 코드 | 의미                                |
| ---- | ----------------------------------- |
| 200  | `{ ok: true, scanned, results }`    |
| 401  | Bearer 없음·불일치(`pnpm dev` 제외) |
| 500  | 설정 누락, Jira/Paperclip 오류 등   |

---

## Paperclip으로 보내는 것

- **생성** `POST /api/companies/{companyId}/issues`: `title`, `description`, 필요 시 `status`, `priority`, `projectId`, 신규면 `assigneeAgentId`
- **갱신** `PATCH /api/issues/{id}`: 제목·본문·상태 등이 함께 갱신될 수 있음

`description`: Jira 메타·본문 평문(ADF는 `description-text.ts`에서 추출). **신규에만** `## Plan (draft, from Jira)` 블록 추가. 갱신 시에는 플랜 블록 없음.

신규 담당 에이전트: 환경의 ID → 없으면 `urlKey` 조회 → 기본 `jira-controller`. 매칭 실패 시 생성 실패.

---

## 코드에서 직접 호출

```typescript
import { JiraStorageRepository } from "@/server/integrations/jira/storage";
import {
  processJiraWebhookEvent,
  type JiraSyncEnvironment,
} from "@/server/integrations/jira/sync";
import { normalizeJiraWebhookEvent } from "@/server/integrations/jira/webhook";

const repository = await JiraStorageRepository.create({
  storeFilePath: "/tmp/jira-store.sqlite",
  cloudId: process.env.JIRA_CLOUD_ID,
});

const environment: JiraSyncEnvironment = {
  apiUrl: "https://api.example.com",
  apiKey: "secret",
  companyId: "company-id",
  cloudId: "atlassian-cloud-id",
  defaultProjectId: null,
  projectMapping: {},
  newIssueAssigneeAgentId: null,
  newIssueAssigneeAgentUrlKey: "jira-controller",
};

const event = normalizeJiraWebhookEvent(JSON.parse(rawBody), new Headers());
await processJiraWebhookEvent({
  event,
  rawBody: "...",
  repository,
  environment,
});
```

---

## 라이선스

`package.json`의 `private: true`를 따릅니다.

문제 나면 폴링 JSON의 `results`와 Paperclip/Jira 에러 본문을 같이 보면 됩니다.
