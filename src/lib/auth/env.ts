// Server-only auth env loader. Throws clear errors at request time if env
// is misconfigured, so failures surface as 500s instead of silent allows.
//
// NOTE: never expose these via NEXT_PUBLIC_* — APP_PASSWORD must stay server
// side or it leaks into the client bundle.

export type AuthEnv = {
  password: string;
  secret: string;
};

export function loadAuthEnv(): AuthEnv {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!password || password.length < 1) {
    throw new Error(
      "APP_PASSWORD env var is not set. Set it in .env.local (dev) or your hosting provider (prod).",
    );
  }
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET env var must be set and at least 32 chars (use `openssl rand -hex 32`).",
    );
  }
  return { password, secret };
}

export const SESSION_COOKIE = "shuffle-lunch.session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
