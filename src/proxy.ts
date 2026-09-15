import { NextRequest, NextResponse } from "next/server";
import { authenticated } from "./lib/auth";

export function proxy(request: NextRequest) {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return new NextResponse("Dashboard authentication is not configured.", { status: 503 });
  }
  if (!authenticated(request.headers.get("authorization"))) {
    return new NextResponse("Authentication required.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Iran Today", charset="UTF-8"', "Cache-Control": "no-store" } });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health$).*)"] };
