import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth.config";

// Edge-safe NextAuth instance: built from authConfig only, no DB imports.
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/signin"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isPublic) {
    if (isLoggedIn && pathname === "/signin") {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *  - /api/health         (uptime probe, public)
     *  - /api/auth/*         (NextAuth handlers)
     *  - /api/webhooks/*     (signature-verified inbound, public)
     *  - /_next/static, /_next/image, favicon (Next internals)
     */
    "/((?!api/health|api/auth|api/webhooks|_next/static|_next/image|favicon.ico).*)",
  ],
};
