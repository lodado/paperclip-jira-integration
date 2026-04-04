# deepconsole-jira-integration

Jira Cloud 이슈를 **REST 폴링**으로 읽어 **Paperclip** API로 이슈를 만들거나 갱신하는 Next.js(App Router) 서비스입니다. Jira↔Paperclip ID 매핑·멱등·로그는 로컬 JSON(또는 `JIRA_STORAGE_FILE`)에 둡니다.

## Paperclip이란?

[Paperclip](https://paperclip.ing)은 **회사 단위로 이슈(작업)와 AI 에이전트를 묶어 돌리는 운영 플랫폼**입니다. 이슈에 담당 에이전트를 붙이고, 에이전트는 하트비트(짧은 실행 주기)마다 인박스를 보고 **체크아웃 → 실행 → 코멘트·상태 갱신** 같은 흐름으로 일합니다. REST API로 이슈·에이전트·프로젝트·회사를 다루며, 사람은 보드/UI로 같은 데이터를 봅니다.

이 레포는 그 Paperclip 바깥에서 **Jira에만 있는 티켓을 Paperclip 이슈로 넣고, Jira 변경을 Paperclip 쪽 설명·상태 등에 반영**하는 **연동 전용 서비스**입니다. Jira를 없애지 않고, “실행·에이전트 작업” 층을 Paperclip에 두는 구조에 맞춥니다.

## Jira → Paperclip → 작업 플로우

1. **Jira**  
   기획·백로그·보드에서 이슈를 만들고 수정합니다. (여전히 Jira가 업무 티켓의 원천이 될 수 있습니다.)

2. **이 서비스(폴링)**  
   일정 주기(또는 수동 호출)로 Jira에서 최근에 바뀐 이슈를 읽고, 로컬 매핑을 보며 Paperclip에 **없으면 생성·있으면 PATCH** 합니다. Jira 설명·요약·상태 등이 Paperclip 이슈 본문·필드로 옮겨집니다.

3. **Paperclip**  
   동기화된 이슈가 생기면, 설정한 에이전트(예: `jira-controller` 등) 인박스에 잡히거나 사람이 배정할 수 있습니다. 에이전트는 Paperclip 규칙대로 **체크아웃 후 작업**하고, 코멘트·`done` 등으로 마무리합니다.

4. **Jira로 되돌리기**  
   이 레포는 Paperclip → Jira 자동 반영을 하지 않습니다. Jira 상태를 맞추려면 별도 프로세스(수동·다른 자동화)가 필요합니다.

---

## 빠른 시작

```bash
pnpm install
cp .env.example .env.local   # 환경 변수 채우기
pnpm dev
```

- 개발 서버: `http://localhost:3000`
- 폴링: **`GET` 또는 `POST /integrations/jira/poll`**
  - 프로덕션·`pnpm start`: `Authorization: Bearer` + `CRON_SECRET` 또는 `JIRA_POLL_SECRET`
  - `pnpm dev`: Bearer 생략 가능
  - 쿼리(선택): `jql` / `extraJql`, `lookback` / `lookbackMinutes`

```bash
pnpm test
pnpm type-check
pnpm build && pnpm start
```

---

## 동작 요약

1. Cron(예: [Vercel `vercel.json`](vercel.json) — 5분마다) 또는 수동으로 `/integrations/jira/poll` 호출
2. Jira `POST .../rest/api/3/search/jql`로 최근 `updated` 윈도 안 이슈 조회 (`JIRA_POLL_LOOKBACK_MINUTES`, `JIRA_POLL_JQL`)
3. 이슈마다 `processJiraWebhookEvent` → Paperclip `POST`/`PATCH`, 로컬 저장소에 멱등·링크 기록
4. 멱등 키는 `poll:{cloudId}:{issueId}:{fields.updated}` 기반; **티켓당** 멱등·이벤트 로그는 최신만 유지하도록 정리됨

---

## Jira 설정

- [Atlassian API 토큰](https://id.atlassian.com/manage-profile/security/api-tokens) + `JIRA_ATLASSIAN_EMAIL` / `JIRA_ATLASSIAN_API_TOKEN`
- `JIRA_CLOUD_ID`
- 웹훅 불필요

### 폴링 예시

```bash
curl -sS -H "Authorization: Bearer $JIRA_POLL_SECRET" \
  https://your-deployment.example.com/integrations/jira/poll
```

```bash
curl -sS -G --data-urlencode 'jql=AND project = KAN' --data-urlencode 'lookback=60' \
  http://localhost:3000/integrations/jira/poll
```

Vercel 배포 시 대시보드에 **`CRON_SECRET`**을 넣으면 Cron 요청에 Bearer가 붙습니다. 로컬에는 Cron이 없으므로 직접 호출하거나 외부 스케줄러를 쓰면 됩니다.

---

## 환경 변수

### 폴링

| 변수                         | 대체              | 설명                                             |
| ---------------------------- | ----------------- | ------------------------------------------------ |
| `CRON_SECRET`                | —                 | Bearer 검증(있으면 `JIRA_POLL_SECRET`보다 우선)  |
| `JIRA_POLL_SECRET`           | —                 | 수동/외부 Cron용 Bearer                          |
| `JIRA_ATLASSIAN_EMAIL`       | `ATLASSIAN_EMAIL` | Jira Basic 인증 이메일                           |
| `JIRA_ATLASSIAN_API_TOKEN`   | `JIRA_API_TOKEN`  | API 토큰                                         |
| `JIRA_POLL_LOOKBACK_MINUTES` | —                 | `updated >= -Nm`의 N (기본 10, 1–1440)           |
| `JIRA_POLL_JQL`              | —                 | 시간 조건 뒤에 붙는 JQL (`AND project = X` 권장) |

### Paperclip (필수)

| 변수                        | 대체                   | 설명                    |
| --------------------------- | ---------------------- | ----------------------- |
| `JIRA_PAPERCLIP_API_URL`    | `PAPERCLIP_API_URL`    | API 베이스 URL          |
| `JIRA_PAPERCLIP_API_KEY`    | `PAPERCLIP_API_KEY`    | `Authorization: Bearer` |
| `JIRA_PAPERCLIP_COMPANY_ID` | `PAPERCLIP_COMPANY_ID` | 회사 ID                 |

### Paperclip (선택)

| 변수                                              | 대체                                         | 설명                                                                                                     |
| ------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `JIRA_DEFAULT_PROJECT_ID`                         | —                                            | 매핑 없을 때 Paperclip `projectId`                                                                       |
| `JIRA_PROJECT_MAPPING_JSON`                       | —                                            | Jira 프로젝트 id/key → Paperclip `projectId` JSON                                                        |
| `JIRA_PAPERCLIP_NEW_ISSUE_ASSIGNEE_AGENT_ID`      | `PAPERCLIP_NEW_ISSUE_ASSIGNEE_AGENT_ID`      | 신규 이슈에만 `assigneeAgentId` 고정                                                                     |
| `JIRA_PAPERCLIP_NEW_ISSUE_ASSIGNEE_AGENT_URL_KEY` | `PAPERCLIP_NEW_ISSUE_ASSIGNEE_AGENT_URL_KEY` | ID 없을 때 `GET .../agents`로 `urlKey` 매칭(미설정 시 기본 `jira-controller`; 빈 문자열이면 조회 비활성) |

### Jira Cloud (필수)

| 변수            | 설명                                      |
| --------------- | ----------------------------------------- |
| `JIRA_CLOUD_ID` | 외부 키 `jira:{cloudId}:{issueId}`에 사용 |

### 로컬 저장소 (선택)

| 변수                | 설명                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `JIRA_STORAGE_FILE` | 상태 JSON 경로(기본: `.paperclip/integrations/jira-storage.json`) |

서버리스에서는 쓰기 가능한 경로를 지정해야 합니다.

---

## 폴링 HTTP 응답

| 상태 | 의미                                  |
| ---- | ------------------------------------- |
| 200  | `{ ok: true, scanned, results }`      |
| 400  | `lookback` / `lookbackMinutes` 잘못됨 |
| 401  | Bearer 없음·불일치(개발 모드 제외)    |
| 500  | 설정 누락, Jira/Paperclip API 오류 등 |

---

## 이 레포가 Paperclip에 보내는 것

- **생성 `POST /api/companies/{companyId}/issues`:** `title`, `description`, 선택 `status`, `priority`, `projectId`, 신규 시 `assigneeAgentId`(환경·urlKey 조회 결과)
- **갱신 `PATCH /api/issues/{id}`:** 폴링은 changelog가 비어 있어 제목·설명·상태 등이 함께 갱신될 수 있음

`description`은 `sync.ts`에서 조합합니다.

- 공통: `Synced from Jira issue {KEY}.`, Source/ID/EventType, 있으면 `Jira description:` + **평문**(Jira ADF는 `description-text.ts`에서 추출)
- **신규 생성에만** 추가: `---` 아래 `## Plan (draft, from Jira)`(Objective, 선택 Context)
- **갱신 시**에는 위 «공통» 블록만 PATCH(플랜 초안 블록은 보내지 않음)

상태·우선순위 문자열은 `mapStatus` / `mapPriority`로 Paperclip enum에 맞춥니다.

신규 이슈 담당 에이전트: (1) `..._ASSIGNEE_AGENT_ID` (2) 없으면 `..._ASSIGNEE_AGENT_URL_KEY`로 agents 목록 조회 (3) 기본 urlKey `jira-controller`. 매칭 실패 시 생성은 에러로 중단됩니다.

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
  storeFilePath: "/tmp/jira-store.json",
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

디버깅 시 폴링 JSON의 `results`, JQL·lookback, Paperclip API 응답 본문을 함께 보면 좋습니다.
