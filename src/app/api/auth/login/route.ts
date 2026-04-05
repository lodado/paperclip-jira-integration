import { NextResponse } from "next/server";

import {
  consoleSessionCookieName,
  consoleSessionMaxAgeSec,
  getConsoleAuthConfig,
  signConsoleSession,
} from "@/lib/console-session";
import { timingSafeStringEqual } from "@/lib/timing-safe-string";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = getConsoleAuthConfig();
  if (!config.enabled) {
    return NextResponse.json(
      {
        error:
          "Console login is not configured. Set CONSOLE_LOGIN_PASSWORD and CONSOLE_SESSION_SECRET.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send JSON with a password field." },
      { status: 400 },
    );
  }

  const record = (body || {}) as Record<string, unknown>;
  const password = typeof record.password === "string" ? record.password : null;
  if (password === null || password.length === 0) {
    return NextResponse.json(
      { error: "Password is required." },
      { status: 400 },
    );
  }

  if (!timingSafeStringEqual(password, config.password)) {
    return NextResponse.json(
      { error: "That password is not correct. Try again." },
      { status: 401 },
    );
  }

  const token = await signConsoleSession(config.secret);
  const maxAge = consoleSessionMaxAgeSec();
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: consoleSessionCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return response;
}
