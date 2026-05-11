import { test, expect, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { loadRecentPairs, pairKey } from "./pair-history";

const tempDir = `/tmp/shuffle-history-test-${Math.random().toString(36).slice(2, 10)}`;

afterAll(async () => {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore.
  }
});

test("loadRecentPairs reads JSON history and reconstructs co-occurrence counts", async () => {
  await mkdir(tempDir, { recursive: true });

  // Two groups in one run:
  //   Group 1: members 1, 2, 3  → pairs (1,2), (1,3), (2,3)
  //   Group 2: members 4, 5     → pair (4,5)
  const entry = {
    id: "2026-05-11T00-00-00-000Z",
    label: null,
    runAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z",
    groups: [
      [{ no: 1 }, { no: 2 }, { no: 3 }],
      [{ no: 4 }, { no: 5 }],
    ],
  };
  await writeFile(`${tempDir}/${entry.id}.json`, JSON.stringify(entry));

  const recent = await loadRecentPairs(1, tempDir);
  // Expected: 4 distinct pairs, all count=1, maxSeen=1.
  expect(recent.maxSeen).toBe(1);
  expect(recent.pairs.size).toBe(4);
  expect(recent.pairs.get(pairKey(1, 2))).toBe(1);
  expect(recent.pairs.get(pairKey(1, 3))).toBe(1);
  expect(recent.pairs.get(pairKey(2, 3))).toBe(1);
  expect(recent.pairs.get(pairKey(4, 5))).toBe(1);
  // No cross-group pair.
  expect(recent.pairs.has(pairKey(1, 4))).toBe(false);
});

test("loadRecentPairs returns empty when lookbackRuns is 0", async () => {
  const recent = await loadRecentPairs(0, tempDir);
  expect(recent.pairs.size).toBe(0);
  expect(recent.maxSeen).toBe(0);
});
