import http from "node:http";

import { test, expect } from "@playwright/test";

type CapturedIssueRequest = {
  summary: string;
  body: Record<string, unknown>;
};

const mockPort = 45679;
let server: http.Server;
const captured: CapturedIssueRequest[] = [];

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.includes("/rest/api/3/issue")) {
      const body = await readJsonBody(req);
      const fields = (body.fields as Record<string, unknown>) || {};
      const summary = String(fields.summary || "");
      captured.push({ summary, body });

      if (summary.includes("upstream-fail")) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ errorMessages: ["mock failure"] }));
        return;
      }

      const delayMs = summary.includes("slow") ? 200 : 0;
      await new Promise((r) => setTimeout(r, delayMs));

      const key = summary.includes("fast") ? "MAY-FAST" : "MAY-101";
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: key === "MAY-FAST" ? "10002" : "10001",
          key,
          self: `https://example.atlassian.net/browse/${key}`,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(mockPort, "127.0.0.1", () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("rejects unauthorized request", async ({ request }) => {
  const response = await request.post("/integrations/jira/tasks", {
    data: { summary: "abc" },
  });

  expect(response.status()).toBe(401);
});

test("EP/BVA: validates summary boundaries and creates task", async ({ request }) => {
  const headers = { Authorization: "Bearer planner-secret" };

  const tooShort = await request.post("/integrations/jira/tasks", {
    headers,
    data: { summary: "ab" },
  });
  expect(tooShort.status()).toBe(400);

  const exactBoundary = await request.post("/integrations/jira/tasks", {
    headers,
    data: {
      summary: "abc",
      requirements: "create spec-driven task",
      spec: {
        acceptanceCriteria: ["Task created in Jira"],
      },
    },
  });

  expect(exactBoundary.status()).toBe(201);
  const json = await exactBoundary.json();
  expect(json.ok).toBe(true);
  expect(json.issue.key).toBe("MAY-101");

  const lastCaptured = captured[captured.length - 1];
  expect(lastCaptured.summary).toBe("abc");
});

test("returns upstream error partition as 502", async ({ request }) => {
  const response = await request.post("/integrations/jira/tasks", {
    headers: { Authorization: "Bearer planner-secret" },
    data: { summary: "trigger-upstream-fail" },
  });

  expect(response.status()).toBe(502);
  const body = await response.json();
  expect(String(body.error)).toContain("Jira issue create failed");
});

test("async race: later fast request returns before earlier slow request", async ({ request }) => {
  const headers = { Authorization: "Bearer planner-secret" };

  const slowPromise = request.post("/integrations/jira/tasks", {
    headers,
    data: { summary: "slow request" },
  });
  const fastPromise = request.post("/integrations/jira/tasks", {
    headers,
    data: { summary: "fast request" },
  });

  const fast = await fastPromise;
  expect(fast.status()).toBe(201);
  const fastBody = await fast.json();
  expect(fastBody.issue.key).toBe("MAY-FAST");

  const slow = await slowPromise;
  expect(slow.status()).toBe(201);
});
