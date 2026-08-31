import { NextResponse, type NextRequest } from "next/server";

/**
 * Mirrors STAFF_SESSION_COOKIE in src/lib/api.ts. Restated rather than imported
 * so the edge bundle stays free of zod and the contracts package.
 */
const STAFF_SESSION_COOKIE = "barat_staff_session";

/**
 * A cheap first pass only: it proves a session cookie exists, not that it is
 * valid or that its role may see the route. The layouts call getSession(), which
 * asks the API, and the API decides the real answer.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/login") return NextResponse.next();

  if (!request.cookies.has(STAFF_SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Only ever a same-origin path, so it cannot be turned into an open redirect.
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * `api/` is excluded because middleware runs before rewrites: in development
     * /api/* is proxied straight to the API, which answers 401 itself. The panel
     * defines no API routes of its own, so nothing here is left unguarded.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
  ],
};
