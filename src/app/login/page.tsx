import { Suspense } from "react";

import { getConsoleAuthConfig } from "@/lib/console-session";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  const config = getConsoleAuthConfig();
  if (!config.enabled) {
    return (
      <main>
        <h1>Console sign-in</h1>
        <p>
          Console login is not enabled. Set <code>CONSOLE_LOGIN_PASSWORD</code>{" "}
          and <code>CONSOLE_SESSION_SECRET</code> to protect the web UI.
        </p>
        <p>
          <a href="/">Back to home</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Console sign-in</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
