// Stable string→u32 hash used to derive the solver's numeric seed from a
// user-typed string seed. Fowler-Noll-Vo (FNV-1a 32-bit). Same string always
// hashes to the same number so users can reproduce a run by reusing the
// string.
export function hashSeedString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const DEFAULT_SEED_STRING = "wevnal-shuffle-lunch";
