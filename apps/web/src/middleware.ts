import { NextResponse, type NextRequest } from "next/server";

/**
 * Mirrors AUTH_SESSION_COOKIE in src/lib/api.ts. Restated rather than imported
 * so the edge bundle stays free of zod and the contracts package.
 */
const AUTH_SESSION_COOKIE = "barat_session";

/**
 * A cheap first pass over /account only: it proves a session cookie exists, not
 * that it is valid. The account layout calls getSession(), which asks the API,
 * and the API re-decides ownership on every /api/account/* call.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (request.cookies.has(AUTH_SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // Only ever a same-origin path, so it cannot be turned into an open redirect.
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/account", "/account/:path*"],
};
