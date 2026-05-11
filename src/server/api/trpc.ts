import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { verifySessionToken } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/env";

export type Context = {
  isAuthed: boolean;
};

// Build the tRPC context from a Fetch Request — verifies the session cookie
// using the same HMAC scheme as the middleware. Defense in depth: even if a
// route bypasses middleware, every procedure still requires a valid session.
export async function createContextFromRequest(req: Request): Promise<Context> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { isAuthed: false };

  const cookieHeader = req.headers.get("cookie") ?? "";
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return { isAuthed: false };
  const isAuthed = await verifySessionToken(token, secret);
  return { isAuthed };
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError ? error.cause.flatten() : null,
    },
  }),
});

const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.isAuthed) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});

export const router = t.router;
export const publicProcedure = t.procedure.use(requireAuth);
export const createCallerFactory = t.createCallerFactory;
