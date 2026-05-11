import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  timingSafeEqualString,
} from "@/lib/auth/session";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, loadAuthEnv } from "@/lib/auth/env";

export const runtime = "nodejs";

const Body = z.object({ password: z.string().min(1) });

export async function POST(req: Request) {
  let auth: ReturnType<typeof loadAuthEnv>;
  try {
    auth = loadAuthEnv();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "auth misconfigured" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "missing password" }, { status: 400 });
  }

  // Constant-time comparison so the response time can't be used to deduce
  // the secret length or prefix.
  if (!timingSafeEqualString(parsed.data.password, auth.password)) {
    return NextResponse.json({ error: "incorrect password" }, { status: 401 });
  }

  const token = await createSessionToken(auth.secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
