// Storage abstraction. Routes to Vercel Blob when BLOB_READ_WRITE_TOKEN is
// set, otherwise reads/writes the local working directory.
//
// All paths in this module are blob-style "pathnames" — slash-delimited keys
// like `data/enriched/1.json`. On disk they're interpreted as relative paths
// from the process CWD.
//
// Blob access mode is **private**: bytes never traverse a public URL. Reads
// go through @vercel/blob's `get()` (which signs the request with the
// project's read-write token) and bytes are returned over tRPC, which is
// already gated by the password / session cookie. The blob URLs themselves
// are never exposed to the browser.

import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  access,
  stat,
} from "node:fs/promises";
import { dirname } from "node:path";
import { put, list, del, head, get } from "@vercel/blob";

const BLOB_ACCESS = "private" as const;

export function usingBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Normalize blob keys to NFC. macOS stores filenames in NFD (decomposed
// Unicode), so when readdir() yields a path containing Japanese kana, it
// can disagree byte-for-byte with the same string written as a literal in
// source code (which editors save as NFC). The blob store treats keys as
// raw bytes, so the mismatch surfaces as "not found" on otherwise-correct
// lookups. Normalizing on every read AND every write keeps both ends in
// the same canonical form.
function nfc(pathname: string): string {
  return pathname.normalize("NFC");
}

export async function readBytes(pathname: string): Promise<Buffer> {
  if (usingBlob()) {
    // useCache:false bypasses the CDN. Without it, get() can return a stale
    // body for ~30s after a write — the read-after-write window swallowed our
    // members.create response and the next list call still saw the prior
    // members.json. The app is small-data + low-volume so the round trip to
    // origin storage is cheap; correctness wins.
    const result = await get(nfc(pathname), {
      access: BLOB_ACCESS,
      useCache: false,
    });
    if (!result) {
      throw new Error(`Blob not found: ${pathname}`);
    }
    if (result.statusCode !== 200 || !result.stream) {
      throw new Error(
        `Blob fetch returned ${result.statusCode} for ${pathname}`,
      );
    }
    return await streamToBuffer(result.stream);
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
    await put(nfc(pathname), body as Buffer, {
      access: BLOB_ACCESS,
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
    await put(nfc(pathname), text, {
      access: BLOB_ACCESS,
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
  const normalized = nfc(prefix.endsWith("/") ? prefix : `${prefix}/`);
  if (usingBlob()) {
    const out: DirEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: normalized, cursor });
      for (const b of page.blobs) {
        const blobPath = nfc(b.pathname);
        // Only direct children, no nested.
        const rest = blobPath.slice(normalized.length);
        if (rest.length === 0 || rest.includes("/")) continue;
        out.push({
          name: rest,
          pathname: blobPath,
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
    try {
      await head(nfc(pathname));
      return true;
    } catch {
      return false;
    }
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
    try {
      await del(nfc(pathname));
    } catch {
      // ignore — same semantics as the local fs branch (no error if missing)
    }
    return;
  }
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(pathname);
  } catch {
    // ignore
  }
}

async function streamToBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
