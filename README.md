# shuffle-lunch

Score-based group solver for the company lunch shuffle. A Next.js dashboard
runs the solver in a Web Worker (in your browser, not on the server), with a
tRPC backend that only handles filesystem / Vercel Blob reads.

A Bun-powered CLI shares the same scoring code for headless / batch runs.

## What lives where

- `src/` — Next.js 16 App Router app (dashboard, login, tRPC routers, Web
  Worker)
- `cli/` — shared TypeScript library + CLI commands (under `cli/cmd/`)
- `cli/grouping/` — pure browser-safe solver (simulated annealing + scoring)
- `cli/storage.ts` — file IO abstraction. Routes to **Vercel Blob** when
  `BLOB_READ_WRITE_TOKEN` is set, else local filesystem. The web app and CLI
  both go through it.
- `data/`, `members.xlsx`, `import/` — sensitive PII. **Not committed.**
  Stored in Vercel Blob in production; on disk during local dev.

## Local development

```bash
bun install
cp .env.example .env.local
# fill in APP_PASSWORD, AUTH_SECRET (openssl rand -hex 32),
# and BLOB_READ_WRITE_TOKEN if you want to test against blob.
bun run dev
```

Open <http://localhost:3000>, sign in with `APP_PASSWORD`.

Without `BLOB_READ_WRITE_TOKEN`, the app reads from your local
`data/` and `import/` folders. With the token set, it reads from Vercel Blob.

## CLI

```bash
bun cli/cmd/index.ts <command>

# common commands
bun cli/cmd/index.ts shuffle           # interactive solver
bun cli/cmd/index.ts report            # company breakdown
bun cli/cmd/index.ts profiles          # dump merged member profiles as JSON
bun cli/cmd/index.ts blob-sync         # upload local data → Vercel Blob
bun cli/cmd/index.ts blob-sync --dry-run
```

`blob-sync` only uploads `.json` / `.xlsx` / `.csv` / `.md` (Notion image
attachments are skipped — pass `--include-all` to override).

## Tests

```bash
bun test
```

## Deploy to Vercel

1. **Create a public GitHub repo and push.** The repo will not contain any
   PII — `members.xlsx`, `data/`, and `import/` are gitignored.
2. **Create a Vercel project from that repo.**
3. **Attach Vercel Blob storage** to the project: Project → Storage →
   Create → Blob. This auto-sets `BLOB_READ_WRITE_TOKEN` for all
   environments.
4. **Add env vars** under Project → Settings → Environment Variables:
   - `APP_PASSWORD` — the sign-in password
   - `AUTH_SECRET` — `openssl rand -hex 32`
5. **Sync your local data into Blob:**
   ```bash
   vercel env pull .env.local         # pulls BLOB_READ_WRITE_TOKEN
   bun cli/cmd/index.ts blob-sync     # uploads members.xlsx, data/*, import/*
   ```
6. **Deploy.** Vercel autodetects Next.js. Default install/build commands
   work as-is.

## Auth model

- `APP_PASSWORD` and `AUTH_SECRET` are server-only env vars (no
  `NEXT_PUBLIC_` exposure).
- `POST /api/auth/login` does a constant-time password compare and sets an
  HMAC-signed `shuffle-lunch.session` cookie (HttpOnly, SameSite=Lax, 7-day
  expiry).
- A Next.js proxy (`src/proxy.ts`) gates every route except `/login` and
  `/api/auth/*`.
- The tRPC server context re-verifies the cookie — defense in depth, so
  routes are still protected even if the proxy is bypassed.

## Architecture notes

- **Compute is client-side.** The solver runs in a Web Worker so the UI
  stays responsive and Vercel functions don't burn CPU on the user's behalf.
- **Server is fs/blob only.** tRPC routers do nothing but parse data files
  and return them.
- **History is JSON.** Each saved run is one canonical
  `data/history/<id>.json` — round-trippable through the editor for tweaking
  group assignments and re-saving.
