import { NextResponse, type NextRequest } from "next/server";

import {
  consoleSessionCookieName,
  getConsoleAuthConfig,
  verifyConsoleSessionToken,
} from "@/lib/console-session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/integrations") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/login" ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  const config = getConsoleAuthConfig();
  if (!config.enabled) {
    return NextResponse.next();
  }

  const token = request.cookies.get(consoleSessionCookieName())?.value;
  if (!token) {
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  const session = await verifyConsoleSessionToken(token, config.secret);
  if (!session) {
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname + request.nextUrl.search);
    login.searchParams.set("reason", "expired");
    const response = NextResponse.redirect(login);
    response.cookies.set({
      name: consoleSessionCookieName(),
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/((?!integrations|_next/static|_next/image|favicon.ico).*)"],
};
