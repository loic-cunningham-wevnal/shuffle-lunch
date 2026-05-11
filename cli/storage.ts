// Storage abstraction. Routes to Vercel Blob when BLOB_READ_WRITE_TOKEN is
// set, otherwise reads/writes the local working directory.
//
// All paths in this module are blob-style "pathnames" — slash-delimited keys
// like `data/enriched/1.json`. On disk they're interpreted as relative paths
// from the process CWD.
//
// Why both backends in one module:
//   - The web app (Vercel) always has the token, so it goes to Blob.
//   - Local dev / CLI without the token works with the same files on disk —
//     no setup overhead just to run `bun cli/cmd/index.ts shuffle` against a
//     local data tree.
//   - The blob-sync CLI command sets the token to push local files up.

import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  access,
  stat,
} from "node:fs/promises";
import { dirname } from "node:path";
import { put, list, del, head } from "@vercel/blob";

export function usingBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function readBytes(pathname: string): Promise<Buffer> {
  if (usingBlob()) {
    const url = await resolveBlobUrl(pathname);
    if (!url) {
      throw new Error(`Blob not found: ${pathname}`);
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Blob fetch failed for ${pathname}: ${res.status} ${res.statusText}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return await readFile(pathname);
}

export async function readText(pathname: string): Promise<string> {
  const buf = await readBytes(pathname);
  return buf.toString("utf8");
}

export async function readJson<T = unknown>(pathname: string): Promise<T> {
  return JSON.parse(await readText(pathname)) as T;
}

export async function writeBytes(
  pathname: string,
  body: Buffer | ArrayBuffer | Uint8Array | string,
): Promise<void> {
  if (usingBlob()) {
    await put(pathname, body as Buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  await mkdir(dirname(pathname), { recursive: true });
  await writeFile(pathname, body as Buffer);
}

export async function writeText(
  pathname: string,
  text: string,
): Promise<void> {
  if (usingBlob()) {
    await put(pathname, text, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: pathname.endsWith(".json")
        ? "application/json"
        : "text/plain",
    });
    return;
  }
  await mkdir(dirname(pathname), { recursive: true });
  await writeFile(pathname, text, "utf8");
}

export type DirEntry = {
  name: string;     // filename only (no prefix), like readdir's output
  pathname: string; // full path / blob key
  sizeBytes?: number;
  modifiedAt?: string;
};

// List entries directly under `prefix` (no recursion). Returns [] on missing
// directory — callers can treat empty + missing the same.
export async function listDir(prefix: string): Promise<DirEntry[]> {
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (usingBlob()) {
    const out: DirEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: normalized, cursor });
      for (const b of page.blobs) {
        // Only direct children, no nested.
        const rest = b.pathname.slice(normalized.length);
        if (rest.length === 0 || rest.includes("/")) continue;
        out.push({
          name: rest,
          pathname: b.pathname,
          sizeBytes: b.size,
          modifiedAt: b.uploadedAt.toISOString(),
        });
      }
      cursor = page.cursor ?? undefined;
    } while (cursor);
    return out;
  }
  try {
    const entries = await readdir(prefix);
    const out: DirEntry[] = [];
    for (const name of entries) {
      const path = `${prefix}/${name}`;
      try {
        const s = await stat(path);
        if (!s.isFile()) continue;
        out.push({
          name,
          pathname: path,
          sizeBytes: s.size,
          modifiedAt: s.mtime.toISOString(),
        });
      } catch {
        // skip unreadable
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function exists(pathname: string): Promise<boolean> {
  if (usingBlob()) {
    return (await resolveBlobUrl(pathname)) !== null;
  }
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

export async function remove(pathname: string): Promise<void> {
  if (usingBlob()) {
    const url = await resolveBlobUrl(pathname);
    if (!url) return; // already gone — no-op
    await del(url);
    return;
  }
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(pathname);
  } catch {
    // ignore — same semantics as blob no-op
  }
}

// Vercel Blob doesn't have a "get by pathname" call — you need the URL. With
// addRandomSuffix: false, the URL is stable, so head() finds it.
async function resolveBlobUrl(pathname: string): Promise<string | null> {
  try {
    const meta = await head(pathname);
    return meta.url;
  } catch {
    return null;
  }
}
