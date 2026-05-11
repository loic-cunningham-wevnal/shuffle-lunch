import { readdir, stat } from "node:fs/promises";

// Recursive file iterator. Skips hidden files (name starts with `.`).
export async function* walkLocalFiles(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const path = `${root}/${e.name}`;
    if (e.isDirectory()) {
      yield* walkLocalFiles(path);
    } else if (e.isFile()) {
      // Some filesystems give isFile() false for symlinks etc.; double-check.
      try {
        const s = await stat(path);
        if (s.isFile()) yield path;
      } catch {
        // skip
      }
    }
  }
}
