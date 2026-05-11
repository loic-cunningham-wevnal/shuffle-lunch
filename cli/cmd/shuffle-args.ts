import { METRIC_KEYS, type MetricKey } from "../grouping/profile-config";

export type ShuffleArgs = {
  profile: string | null;
  weightOverrides: Partial<Record<MetricKey, number>>;
  ageCurveExponent: number | null;
  iterations: number | null;
  restarts: number | null;
  seed: number | null;
  size: number | null;
  count: number | null;
  saveAs: string | null;
  noHistory: boolean;
  out: string | null;
};

const WEIGHT_KEY_ALIASES: Record<string, MetricKey> = {
  gender: "genderBalance",
  dept: "deptDiversity",
  ei: "eiBalance",
  vibe: "vibeDiversity",
  mbti: "mbtiDiversity",
  age: "ageProximity",
  tenure: "tenureMix",
  confidence: "confidenceFloor",
  recent: "recentPairPenalty",
};

const VALID_KEYS = new Set<string>([
  ...METRIC_KEYS,
  ...Object.keys(WEIGHT_KEY_ALIASES),
]);

export function parseShuffleArgs(argv: string[]): ShuffleArgs {
  const out: ShuffleArgs = {
    profile: null,
    weightOverrides: {},
    ageCurveExponent: null,
    iterations: null,
    restarts: null,
    seed: null,
    size: null,
    count: null,
    saveAs: null,
    noHistory: false,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--profile") out.profile = takeStr(argv, ++i, "--profile");
    else if (a === "--save-as") out.saveAs = takeStr(argv, ++i, "--save-as");
    else if (a === "--seed") out.seed = takeInt(argv, ++i, "--seed");
    else if (a === "--age-curve")
      out.ageCurveExponent = takeFloat(argv, ++i, "--age-curve", { min: 0 });
    else if (a === "--iterations") out.iterations = takeInt(argv, ++i, "--iterations", { min: 1 });
    else if (a === "--restarts") out.restarts = takeInt(argv, ++i, "--restarts", { min: 1 });
    else if (a === "--size") out.size = takeInt(argv, ++i, "--size", { min: 2 });
    else if (a === "--count") out.count = takeInt(argv, ++i, "--count", { min: 1 });
    else if (a === "--no-history") out.noHistory = true;
    else if (a === "--out") out.out = takeStr(argv, ++i, "--out");
    else if (a.startsWith("--weight.")) {
      const key = a.slice("--weight.".length);
      if (!VALID_KEYS.has(key)) {
        throw new Error(
          `Unknown weight key: ${key}. Valid: ${[...VALID_KEYS].sort().join(", ")}`,
        );
      }
      const canonical = (WEIGHT_KEY_ALIASES[key] ?? key) as MetricKey;
      out.weightOverrides[canonical] = takeFloat(argv, ++i, a, { min: 0 });
    } else {
      throw new Error(`Unknown shuffle arg: ${a}`);
    }
  }
  return out;
}

function takeStr(argv: string[], i: number, name: string): string {
  const v = argv[i];
  if (v === undefined) throw new Error(`${name} requires a value`);
  return v;
}

function takeInt(
  argv: string[],
  i: number,
  name: string,
  bounds: { min?: number } = {},
): number {
  const v = argv[i];
  if (v === undefined) throw new Error(`${name} requires a value`);
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  if (bounds.min !== undefined && n < bounds.min)
    throw new Error(`${name} must be >= ${bounds.min}`);
  return n;
}

function takeFloat(
  argv: string[],
  i: number,
  name: string,
  bounds: { min?: number } = {},
): number {
  const v = argv[i];
  if (v === undefined) throw new Error(`${name} requires a value`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  if (bounds.min !== undefined && n < bounds.min)
    throw new Error(`${name} must be >= ${bounds.min}`);
  return n;
}
