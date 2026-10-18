import { NextResponse, type NextRequest } from "next/server";

// The POS screens are for the POS computer and the restaurant Wi-Fi only.
// Requests from the internet arrive through Cloudflare (cf-ray header) and are
// refused. Customer QR ordering still works: it comes through the customer
// gateway, which does not pass Cloudflare headers on.
export function middleware(req: NextRequest) {
  if (req.headers.get("cf-ray") || req.headers.get("cf-connecting-ip")) {
    return new NextResponse(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<title>Not available</title><body style='font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px'>" +
      "<div><h1 style='font-size:20px'>Not available here</h1><p style='color:#666'>The Golden POS staff screens only work on the restaurant Wi-Fi.</p></div></body>",
      { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
