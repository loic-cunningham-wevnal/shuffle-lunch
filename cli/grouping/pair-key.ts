// Pure helpers for pair-co-occurrence bookkeeping. Browser-safe.
export type RecentPairs = {
  pairs: Map<string, number>; // "a-b" (a<b) → co-occurrence count
  maxSeen: number;
};

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
