const PAREN_SPLIT = /[（）()【】「」\[\]『』]/g;
const JAPANESE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾝ]/g;
const ASCII_RUN = /[A-Za-z]+/g;
const MIN_JA_KEY = 2;
const MIN_LATIN_KEY = 4;

// Map traditional/variant kanji to their common-use form. Kept small and
// targeted: only variants we've actually seen collide between Excel and Notion.
const KANJI_VARIANTS: Record<string, string> = {
  "髙": "高",
  "曾": "曽",
  "齋": "斎",
  "齊": "斉",
  "邊": "辺",
  "邉": "辺",
  "澤": "沢",
  "濱": "浜",
  "嶋": "島",
  "嵜": "崎",
  "凜": "凛",
  "祐": "佑",
};

function foldKanji(s: string): string {
  let out = "";
  for (const ch of s) out += KANJI_VARIANTS[ch] ?? ch;
  return out;
}

export function nameKeys(name: string): string[] {
  const segments = name.split(PAREN_SPLIT).filter((s) => s.trim().length > 0);
  const keys = new Set<string>();
  for (const seg of segments) {
    const ja = foldKanji((seg.match(JAPANESE) ?? []).join(""));
    if (ja.length >= MIN_JA_KEY) keys.add(`ja:${ja}`);

    const tokens = (seg.match(ASCII_RUN) ?? []).map((t) => t.toLowerCase());
    const concat = tokens.join("");
    if (concat.length >= MIN_LATIN_KEY) {
      keys.add(`en:${concat}`);
      // Order-independent variant: lets "Ergun Ugurcan" match "Ugurcan Ergun".
      if (tokens.length > 1) {
        const sorted = [...tokens].sort().join("");
        keys.add(`enset:${sorted}`);
      }
    }
  }
  return [...keys];
}

export class NameIndex<T> {
  private byKey = new Map<string, T[]>();

  constructor(items: T[], extract: (item: T) => string) {
    for (const item of items) {
      for (const key of nameKeys(extract(item))) {
        const list = this.byKey.get(key) ?? [];
        list.push(item);
        this.byKey.set(key, list);
      }
    }
  }

  find(name: string): T | null {
    for (const key of nameKeys(name)) {
      const matches = this.byKey.get(key);
      if (matches && matches.length > 0) return matches[0]!;
    }
    return null;
  }
}
