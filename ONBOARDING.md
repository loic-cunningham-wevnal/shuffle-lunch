# shuffle-lunch — handoff guide

This document is for the next person picking up this codebase. It covers
**what it is**, **how it's architected**, **how it deploys**, and **the
gotchas you will hit if you don't read this first.**

Live: <https://shuffle-lunch-eta.vercel.app>
Repo: <https://github.com/loic-cunningham-wevnal/shuffle-lunch>

---

## TL;DR

A score-based group solver for a company lunch shuffle. Browser-first: the
**simulated-annealing solver runs in a Web Worker on the user's machine**, the
tRPC backend only does blob reads/writes. Data lives in **Vercel Blob (private
access)**; the public GitHub repo intentionally contains zero PII. A Bun-
powered CLI shares the same solver code for headless runs.

```
[browser]                     [vercel func]              [vercel blob]
 Web Worker (solver)  ←→  tRPC route handler  ←→  data/members.json
 React UI / editor         (fs/blob reads only)      data/history/*.json
 ExcelJS (xlsx in/out)                                data/grouping-profiles/*.json
```

---

## What lives where

```
src/
  app/                          Next.js 16 App Router
    api/auth/{login,logout}/    POST endpoints (password → HMAC cookie)
    api/trpc/[trpc]/            tRPC fetch handler (auth-gated)
    login/                      Login page
    page.tsx                    Dashboard entry
  components/                   All React UI (header, groups, drawer, etc.)
  hooks/                        useSolver, useResultState, useFileDrop, …
  lib/                          auth/, settings-store, import-xlsx, seed
  server/api/                   tRPC routers (members, profiles, pairHistory, history)
  workers/solver.worker.ts      Web Worker wrapping buildScoredGroups
  proxy.ts                      Next.js 16 proxy (gates every non-public route)

cli/                            Shared TS library + Bun-only CLI
  storage.ts                    THE abstraction: Vercel Blob ⇄ local fs
  history.ts                    Canonical history JSON schema (HistoryEntry)
  grouping/                     Pure solver (browser-safe — used by the worker too)
    index.ts                    buildScoredGroups (entry point, accepts locks)
    solver.ts                   Simulated annealing
    score.ts, metrics.ts        Scoring functions
    profile-store.ts            Grouping profiles (read/write blob)
    pair-history.ts             Reads recent group history for "recent-pair" metric
    pair-key.ts                 Browser-safe pair-co-occurrence types (split out
                                from pair-history because the latter pulls fs)
  excel-builder.ts              Pure xlsx workbook builder (browser-safe)
  excel-export.ts               fs writer wrapping the builder (CLI-only)
  cmd/                          Bun-only CLI commands
    index.ts                    Dispatcher
    build-members.ts            Parses xlsx + Notion + enrichment → data/members.json
    blob-sync.ts                Uploads canonical JSON files to Vercel Blob
    shuffle.ts                  Interactive solver
    enrich.ts                   AI enrichment via Anthropic SDK
    export-members.ts           Dump current members to xlsx
    import-members.ts           Re-ingest edited xlsx → enrichment cache
    profiles.ts, report.ts      Diagnostics

data/                           LOCAL ONLY — gitignored, never deploys
  members-flat.xlsx             Editable mirror of enrichment fields
  members.json                  Output of `build-members` — uploaded to blob
  enriched/<no>.json            Per-member AI enrichment cache
  grouping-profiles/*.json      Solver profile presets (also in blob)
  history/*.json                Past shuffle runs (also in blob)
  lunch-history/                Legacy, currently unused

import/                         LOCAL ONLY — gitignored
  自己紹介ページ*.csv             Notion CSV export
  自己紹介ページ/*.md             Notion markdown pages

members.xlsx                    LOCAL ONLY — gitignored
                                Master member list from the org
```

The `cli/` directory does double duty: it's where the Bun CLI commands live,
*and* it's the shared library imported by the Next.js web app via the
`@cli/*` path alias (configured in `tsconfig.json`). The split between
"server-safe" and "browser-safe" code matters — see the **Storage
abstraction** and **Browser-safe split** sections below.

---

## The PII boundary

This was the **single most important architectural constraint**: the GitHub
repo is **public**, but the data is **private PII** (names, ages, hometowns,
AI-generated psychological summaries of every employee).

Everything sensitive is gitignored at `members.xlsx`, `data/`, `import/`. The
deployed app reads its data from **Vercel Blob (private access)**, populated
by `bun cli/cmd/index.ts blob-sync` from the operator's local files.

Three principles to keep this safe:

1. **Never put PII fields in source code** — no test fixtures with real names,
   no docstrings referencing real members.
2. **Never expose blob URLs to the browser.** Reads go through `cli/storage.ts`,
   which uses `@vercel/blob`'s `get()` with `access: 'private'`. The SDK signs
   the request with `BLOB_READ_WRITE_TOKEN` and streams bytes to the server,
   which then forwards parsed data over tRPC (already auth-gated). The blob
   URLs themselves never leave the server.
3. **Never log full member objects.** Stick to ids in console output.

If you ever add a new field to `FlatMember`, ask "is this PII?" If yes, the
answer is automatically blob-only — same flow.

---

## Browser-first compute

The dashboard auto-runs the solver on every settings change. Doing this server-
side would burn Vercel function CPU per slider drag for every user. So the
solver lives in a **Web Worker on the user's machine** (`src/workers/
solver.worker.ts`), driven by `useSolver` (`src/hooks/use-solver.ts`).

Consequences:

- The solver and its dependencies must be **browser-safe**. No `node:fs`, no
  `node:crypto`, no `Bun.*`. Anything in `cli/grouping/*.ts`, `cli/flat-
  member.ts`, `cli/groups.ts`, `cli/excel-builder.ts` must stay pure.
- The split was real work. Specifically:
  - `cli/grouping/pair-history.ts` reads xlsx history from disk → that's
    server-side. The `pairKey()` helper and `RecentPairs` type are
    used by `metrics.ts` (which IS browser-safe). We **split them out into
    `cli/grouping/pair-key.ts`** so the browser bundle doesn't drag fs in.
  - `cli/excel-export.ts` (fs writer) was split into `cli/excel-builder.ts`
    (pure workbook construction) + `cli/excel-export.ts` (the disk writer).
    The browser only imports `excel-builder`.
- The worker receives `BuildScoredGroupsOptions` via `postMessage`. **`Map`
  survives structured clone** — that's why locks ship as a `Map<no, target>`.
- Cancellation: `useSolver` `terminate()`s the worker and spawns a new one
  for every new run. With ~50k iterations × 4 restarts the solver takes
  ~0.5-1.5s on modern hardware; cancellation is rarely visible.

The tRPC server-side endpoints (`members.list`, `pairHistory.recent`,
`history.list/get/save/delete`) **only do fs/blob reads + writes**. No
solver, no business logic. This is intentional and load-bearing — keeping the
server stateless lets you survive cold starts cheaply.

---

## Storage abstraction (`cli/storage.ts`)

This is **the** central piece. It exposes:

```ts
usingBlob(): boolean                      // true if BLOB_READ_WRITE_TOKEN is set
readBytes / readText / readJson(path)      // works in both modes
writeBytes / writeText(path, body)
listDir(prefix): DirEntry[]
exists(path): boolean
remove(path): void
```

The same code path runs:
- **Locally with no token**: reads/writes the operator's filesystem (e.g.
  `data/members.json`)
- **Locally with `BLOB_READ_WRITE_TOKEN` pulled via `vercel env pull`**: reads/
  writes Vercel Blob (useful for testing prod data flow without deploying)
- **On Vercel**: token is auto-set; always Blob

### Two non-obvious behaviors

1. **NFC normalization.** macOS filesystems store filenames in **NFD** (e.g.
   "ペ" = ヘ + ◌゙). Source-code string literals like
   `"import/自己紹介ページ"` are NFC (single codepoint). Without
   normalization, uploading from macOS produces NFD blob keys that don't
   match NFC reads → "blob not found" errors. Every blob key is
   `pathname.normalize("NFC")` before sending. **If you ever see Unicode
   filenames erroring "not found", this is the first place to look.**

2. **`useCache: false` for private reads.** `@vercel/blob`'s `get()` defaults
   to serving from the CDN cache. For ~30s after a write, the CDN can return
   stale content. We always pass `useCache: false` so reads bypass the CDN
   and hit origin. This is the right tradeoff for this small/low-volume app
   — correctness > a few ms saved.

### When in doubt

If a tRPC route is reading a file, **don't add `node:fs` imports** — use
`cli/storage.ts`. That keeps the code path identical in dev and prod and
avoids accidentally breaking local-dev fallback.

---

## Auth model

Single-password gate. Two env vars, both server-only (no `NEXT_PUBLIC_`):

- `APP_PASSWORD` — what users type
- `AUTH_SECRET` — `openssl rand -hex 32`, signs session cookies

Flow:
- `POST /api/auth/login` → constant-time password compare (`timingSafeEqualString` in `src/lib/auth/session.ts`) → sets HMAC-SHA256-signed `shuffle-lunch.session` cookie (HttpOnly, SameSite=Lax, Secure in prod, 7-day expiry).
- `POST /api/auth/logout` → clears the cookie.
- **`src/proxy.ts`** (Next.js 16 renamed `middleware.ts` → `proxy.ts`) gates every route except `/login` and `/api/auth/*`. Invalid/missing cookie → redirect to `/login` or 401 JSON for `/api/*`.
- **Defense in depth:** `src/server/api/trpc.ts` re-verifies the cookie in
  `createContextFromRequest` and rejects requests via a `requireAuth`
  middleware applied to `publicProcedure` (the name is a tRPC convention —
  it's actually authed; "public" here means "no role checks").

Cookie token format: `v1.<expiresAtMs>.<base64url(hmac)>`. Web Crypto API,
works in both Edge and Node runtimes.

---

## tRPC routers

All four live in `src/server/api/routers/`:

- **`members.list`** — reads `data/members.json` from storage, returns
  `{ members: FlatMember[], total }`
- **`members.update({ no, patch })`** — merges patch, validates with
  `FlatMemberSchema`, writes back. Patch schema is `.strict()` so unknown
  fields error rather than silently passing through.
- **`members.create(member-without-no)`** — server assigns `no = max + 1`
- **`members.delete({ no })`**
- **`profiles.list/get/save`** — grouping profiles in `data/grouping-profiles/`
- **`pairHistory.recent({ lookbackRuns })`** — parses the most recent N
  history JSONs and returns a `RecentPairs` (Map of "a-b" → count). Used by
  the "recent-pair-penalty" metric to avoid pairing people who lunched
  together recently.
- **`history.list`** — summaries (id, label, runAt, totalScore, …)
- **`history.get({ id })`** — full `HistoryEntry`
- **`history.save({ id?, label?, entry })`** — create new or overwrite by id
- **`history.delete({ id })`**

All inputs are zod-validated. All paths run through `cli/storage.ts`.

---

## The data pipeline

The operator pipeline lives entirely on your laptop. The deployed app only
consumes the output.

```
members.xlsx + import/*.csv + import/自己紹介ページ/*.md
    │
    │  cli/cmd/enrich.ts (Anthropic SDK; uses Claude to infer
    │   gender/MBTI/vibe/confidence/notes from name + bio)
    ▼
data/enriched/<no>.json (cached per-member AI output)
    │
    │  cli/cmd/build-members.ts → cli/cmd/load.ts → cli/profiles.ts
    │   (merges xlsx fields + Notion fields + enrichment cache)
    ▼
data/members.json   ←—— THIS is what the deployed app reads
    │
    │  cli/cmd/blob-sync.ts (uploads + prunes)
    ▼
Vercel Blob: data/members.json, data/history/*.json, data/grouping-profiles/*.json
```

The web app reads **only the canonical JSON files**. Raw inputs
(`members.xlsx`, the Notion folder, the per-member enrichment cache) stay on
the operator's disk; they're CLI-only.

Going forward, edits happen in the deployed UI directly (`members.update`
writes straight to `data/members.json` in blob). The CLI pipeline is for the
initial population and for re-syncing if you change the upstream xlsx /
Notion data.

### CLI command quick reference

```bash
bun cli/cmd/index.ts <cmd>

shuffle          interactive solver, writes a history xlsx
report           company-level stats (gender, MBTI, vibe, dept × …)
profiles         dump merged FlatMember[] as JSON
enrich           refresh AI cache; --force / --limit / -j N
build-members    merge inputs → data/members.json
export-members   write data/members-flat.xlsx for hand-editing
import-members --file <xlsx>  re-ingest manual enrichment edits
blob-sync        upload canonical JSON to blob; --prune --dry-run
```

---

## Deployment

### One-time setup (already done for this repo)

1. Push the repo to GitHub (public). PII is gitignored.
2. Create a Vercel project linked to the repo.
3. **Attach a private Blob store**: `vercel blob create-store shuffle-lunch-data --access private --yes`. The `--yes` flag auto-links the store to Production / Preview / Development and writes `BLOB_READ_WRITE_TOKEN` into all three envs.
4. Set `APP_PASSWORD` and `AUTH_SECRET` per-env (Production, Preview, Development). The Vercel CLI is somewhat awkward about non-interactive Preview env writes; if `--value … --yes` fails, set Preview manually in the dashboard. The current Production password is in `.env.local` and in the Vercel env vars; rotate it via `vercel env rm APP_PASSWORD production` then `vercel env add APP_PASSWORD production`.
5. **Seed the blob**: locally, `vercel env pull .env.local` (this pulls
   `BLOB_READ_WRITE_TOKEN`), then `bun cli/cmd/index.ts blob-sync`. With the
   token set, `build-members` and `blob-sync` will write directly to blob;
   without it, they fall back to local fs. **Both modes work, by design.**

### Deploy

`vercel deploy --prod --yes` from the repo root. Or push to `main` and let
the GitHub integration auto-deploy.

The aliases `shuffle-lunch-eta.vercel.app` and `shuffle-lunch-loic-
cunningham-wevnals-projects.vercel.app` always point at the latest production
deployment.

### Why these scripts

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "cli": "bun cli/cmd/index.ts",
  "shuffle": "bun cli/cmd/index.ts shuffle",
  "test": "bun test"
}
```

Vercel runs the `build` and `start` scripts on its own Node runtime. The CLI
scripts intentionally use Bun directly — they only ever run on a developer's
laptop, never on Vercel.

There was an earlier version of the scripts that ran `bun --bun next dev` to
get Bun's runtime (needed because some files used `Bun.hash`, `Bun.file`,
`Bun.write`). When prepping for Vercel, those Bun APIs were swapped out (see
**Bun → Node portability** below) and the scripts simplified to plain `next
…`. **Don't add `bun --bun`-prefixed scripts back** — they break Vercel
builds.

---

## Browser-safe split (Bun → Node portability)

The CLI started life as a Bun-only tool using `Bun.file`, `Bun.write`,
`Bun.hash`. Those don't exist in Node, which is what Vercel runs. Any file
the tRPC routers transitively import had to be portable.

What got swapped:

- `Bun.hash(json).toString(16)` → `createHash("sha256").update(json).digest("hex").slice(0, 16)` (in `cli/enrichment-cache.ts`)
- `Bun.file(path).text()` → `readFile(path, "utf8")` (in `cli/notion.ts`)
- `Bun.write(path, bytes)` → `writeFile(path, bytes)` (in `cli/grouping/profile-store.ts`, `src/server/api/routers/history.ts` before it got removed in favor of the JSON history flow)
- The `flat-member.ts` hash function was renamed `flatMemberSourceJson` (returns the canonical JSON string only); hashing happens in `enrichment-cache.ts` using Node's crypto. This keeps `flat-member.ts` itself Bun-free so the browser can import it.

`Bun.*` is still used inside `cli/cmd/*.ts` (CLI-only) — those files **never**
get imported by the web app, so they can stay Bun-only.

If you ever add a new tRPC route that reads from disk: **use `cli/storage.ts`
helpers**, not raw `node:fs` and not `Bun.*`. That gives you blob/fs
portability and NFC normalization for free.

---

## Result state machine (`src/hooks/use-result-state.ts`)

The dashboard's central state. A useReducer + localStorage hook that tracks
the currently visible shuffle result. Three modes:

- **Live** — solver output, auto-runs on settings changes
- **Live + edited** — user manually moved members; solver auto-runs are
  paused so the user's edits aren't blown away
- **History** — user loaded a saved entry (or imported an xlsx); solver
  doesn't auto-run

State persists to `localStorage` under `shuffle-lunch.result-state.v1` with
`Map`-aware serialization (locks become `[no, target][]` arrays). On mount
the hook hydrates from storage before the first render that matters. The
**Clear** button in the header dispatches `reset-all` and removes the
localStorage key.

Lock model: `LocksState = Map<no, number | "bench">`. Bench is the sentinel.
When passed to the solver, it's translated to `Map<no, number>` where the
bench is encoded as `groupCount`. The solver's pair-swap and three-cycle
moves both `pickUnlockedMemberIdx` from each group and **refuse to propose
any swap involving a locked member**. Warm-start places locked members in
their target group/bench first, then fills around them.

Edge case: dragging a locked member updates their lock target (move + keep
here), not silently unlocks. This is intentional — the lock describes user
intent, and a move expresses new intent for the same member.

---

## UI features (one-line each)

- **Centered header search** (`src/components/header-search.tsx`) — Cmd/Ctrl-K, type → all matches glow amber + non-matches dim to 25%, Enter/click → scroll+flash. Searches name / romaji / department.
- **Drag-and-drop members** between groups + bench. Native HTML5, custom MIME (`application/x-shuffle-lunch-member`) so it doesn't conflict with text drags. Group cards turn amber when over capacity (manual override allowed; solver still respects `groupSize`).
- **Lock toggle per member** — small padlock icon → click to pin to current group. Header gets a `LOCKED N clear` chip.
- **Edit drawer** (`src/components/member-edit-drawer.tsx`) — slide-in panel with all editable fields organized into Identity / Organization / Personal / Availability / AI enrichment sections. Add (`+ New member`) and Delete (rose link in footer with confirm).
- **History tab** — list past runs, open one → loads into the editor. Save changes (overwrites) or Save as new.
- **Excel preview tab** — tabbed Groups / All Members / Settings view rendering the same data that the .xlsx download would have.
- **Toolbar** — Download (browser-built .xlsx via ExcelJS), Import (parses our own .xlsx format and joins by `no` against current members), Clear (wipes localStorage + resets).
- **Drag .xlsx onto the window** — `src/hooks/use-file-drop.ts` listens at window level, distinguishes OS file drags (`dataTransfer.types.includes("Files")`) from in-app member drags (custom MIME), shows a full-window dashed overlay during the drag.

---

## The login screen

`src/app/login/login-form.tsx`. Single password field, submits via `fetch`
to `/api/auth/login`. Reads `?next=` from the URL and redirects there on
success. Dark, restrained, matches the rest of the dashboard.

If `APP_PASSWORD` or `AUTH_SECRET` env vars are missing, the proxy returns a
500 with a clear message ("Server is missing AUTH_SECRET"). Fails closed —
**never** falls open to unauthenticated access.

---

## Test suite

`bun test` runs 55 tests (all in `cli/`):

- `cli/profiles.test.ts` — end-to-end member loader against the real local
  data (174 members expected). **This test depends on `members.xlsx`,
  `import/*`, etc. being present.** It will not pass on Vercel or in CI
  without the PII files. The intended workflow is: run tests on the
  operator's laptop only.
- `cli/grouping/*.test.ts` — pure solver math + metrics. These DO run
  anywhere because they don't touch the filesystem.

If you set up CI that runs `bun test`, exclude `cli/profiles.test.ts` and
`cli/members-flat-xlsx.test.ts` since they require the local data tree.

---

## Known sharp edges

### 1. `data/profiles.ts` was destroyed once

Early in development, a `mv src cli && mv cli/cli/* cli/ && rmdir cli/cli`
shell sequence collided same-named files. `src/profiles.ts` (the data loader
that stitches members.xlsx + Notion CSV + Notion markdown into a single
`FlatMember[]`), `src/enrich.ts` (AI enrichment library), and `src/index.ts`
(a small test runner) were overwritten by their `src/cli/*` counterparts.
**Profiles was reconstructed from `cli/profiles.test.ts` + neighboring
loader modules and all 7 e2e tests pass.** `enrich.ts` is stubbed with a
clear error (the cached enrichments under `data/enriched/*.json` remain
valid). If you ever need to re-run `cli enrich`, you'll need to rebuild
`cli/enrich.ts` to call the Claude Agent SDK against
`ENRICHMENT_MODEL = "claude-sonnet-4-6"`.

If you ever do another bulk file move, **dry-run with `mv -n` first**.

### 2. Next.js 16: `middleware.ts` is now `proxy.ts`

Next.js 16 deprecated `middleware.ts`. The file is `src/proxy.ts` and exports
a function named `proxy` (not `middleware`). If you upgrade Next further or
add a new middleware, follow the same naming.

### 3. Turbopack vs Webpack config

`next.config.ts` has `turbopack: {}` to satisfy Next 16's "you're using
Turbopack but have a `webpack` config" warning that fired when an earlier
version had a `webpack` callback. **Don't add a `webpack` callback unless
you also set `--webpack` or remove the empty `turbopack` shim.** Vercel will
error your build.

### 4. ExcelJS in the browser

ExcelJS works in browsers but ships some node-isms. We get away with it
because we only use `wb.xlsx.load(buffer)` and `wb.xlsx.writeBuffer()` in
client code (`cli/excel-builder.ts`). If you reach for `wb.xlsx.readFile()`
or `Bun.write`, you've left browser-safe territory — those go in
`cli/excel-export.ts` instead.

### 5. tRPC + superjson + Maps

`Map` survives `superjson` over the wire, which is why `pairHistory.recent`
returns a `RecentPairs` with a real `Map`. **Don't** convert it to a plain
object in transit; the solver expects `Map.has` / `Map.get` semantics.

### 6. Vercel Blob private read-after-write

Already mentioned but worth a heading: `useCache: false` on every read.
Without it, you'll get 30-second-stale reads after writes. The first member
create looked like it succeeded but the next list call missed it — same
root cause.

### 7. Locks survive history-load? No.

Loading a history entry resets locks (it's a fresh editing intent for a
different dataset). This is intentional, see the reducer's `set-from-
history` case. If you want sticky locks, you'd need to scope them per-entry.

### 8. Hot-reload corrupts Turbopack's DB

Twice during development the Turbopack incremental cache (`.next/dev`)
corrupted and `next dev` hung serving 200s on `/api/auth/login` but never
returning. Symptoms: panics in the logs like `Failed to deserialize AMQF
from XXXXX.meta`. **Fix**: `kill $(lsof -ti :3000); rm -rf .next; bun run
dev`. Happens rarely (maybe 1 in 50 restarts during heavy dev).

---

## Common operations

### Update a member's enrichment (UI flow)

1. Sign in
2. Members tab
3. Click row → drawer slides in
4. Edit fields, click Save changes
5. tRPC `members.update` writes back to `data/members.json` in blob
6. List invalidates; row reflects new values

### Add a new member

1. Members tab → `+ New member`
2. Fill in name + department (required) + whatever else
3. Click Create → server assigns next `no`, blob updated, list refreshes

### Save a confirmed shuffle to history

1. Groups tab, tweak / drag / lock as needed
2. Click `Save to history` in the secondary bar
3. Entry appears in History tab as `<runAt timestamp>`
4. Open it later to load + edit; "Save changes" overwrites, "Save as new"
   creates a fresh entry

### Re-sync data from operator's laptop to blob

```bash
# in the repo root, with .env.local containing BLOB_READ_WRITE_TOKEN
bun cli/cmd/index.ts build-members    # parses local sources → data/members.json
bun cli/cmd/index.ts blob-sync        # uploads to blob (with --prune to remove stale)
```

You DON'T need to redeploy after a blob-sync — the next page load reads the
fresh data immediately.

### Rotate the password

```bash
vercel env rm APP_PASSWORD production
vercel env add APP_PASSWORD production       # paste new value via stdin
vercel deploy --prod --yes                   # redeploy so new password takes effect
```

### Rotate `AUTH_SECRET` (invalidates all sessions)

Same as above but `AUTH_SECRET`. After redeploy, every active session is
forced to re-login.

---

## Architectural decisions, retrospective

What I'd do the same:

- **Browser-first compute**. The solver in a Web Worker is the killer
  feature — slider changes feel instant, server cost is zero, and it scales
  to arbitrary user counts.
- **Single storage abstraction** with both fs and blob backends. This let
  the CLI and the web app share 100% of the data loaders and dev/prod
  parity stayed real throughout.
- **JSON history** (not xlsx) as the canonical persisted format. Round-
  trippable through the editor; xlsx is built on-demand for human-facing
  download.

What I'd reconsider:

- **The split between `cli/` and `src/`** is a bit awkward. `cli/` is half
  "CLI code" and half "shared library". A clearer split would be
  `lib/` (shared) + `cli/cmd/` (Bun-only commands) + `src/` (Next.js). Not
  urgent enough to refactor.
- **Univer-style xlsx editor in-browser** was scoped out. The current
  preview is a custom React table that mirrors the .xlsx structure. Works
  fine, but if you ever want full Excel-like editing, the architecture
  supports it cleanly — load + edit happens client-side.

---

## When something breaks

In order of "most likely":

1. **"Blob not found"** for a Unicode pathname → NFC normalization. Check
   `cli/storage.ts`'s `nfc()` is applied everywhere.
2. **`Bun is not defined`** in a Vercel function → some file imported by a
   tRPC route grew a new `Bun.*` reference. Find and swap for the Node
   equivalent (or move the import into a `cli/cmd/*.ts` file that's CLI-
   only).
3. **Stale data after a write** → CDN cache. `useCache: false` on every
   read in `cli/storage.ts`. If you call `@vercel/blob` directly elsewhere,
   apply the same flag.
4. **Hung `/api/trpc/…` requests in dev** → `.next/dev` corrupted, `rm -rf
   .next && bun run dev`.
5. **Login redirect loop** → `AUTH_SECRET` mismatch between the env that
   set the cookie and the env validating it (e.g. rotated `AUTH_SECRET`
   without redeploying, or `.env.local` got overwritten by `vercel env
   pull` and lost local APP_PASSWORD/AUTH_SECRET). Restore both, restart
   dev.
6. **Solver finishes but groups don't update** → check `inHistoryMode`. If
   you're viewing a loaded entry, the solver doesn't auto-run. Click
   "back to live" or load a fresh state.

---

## Final notes

- The codebase is intentionally **small and direct**. Most files are <200
  lines. Don't reach for state-management libraries (zustand handles the
  one-state-blob settings store; everything else is `useState` or
  `useReducer`). Don't introduce a CSS framework beyond Tailwind v4.
- Run `bunx tsc --noEmit` after any structural change. Type errors are the
  first signal that something cross-cuts the browser/server boundary.
- 55 tests, all passing as of this writing. **Keep them passing.**

Good luck.
