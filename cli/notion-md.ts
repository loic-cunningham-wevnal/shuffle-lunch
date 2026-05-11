export type NotionPage = {
  filePath: string;
  title: string;
  properties: Record<string, string>;
  comment: string | null;
  tableCells: Record<string, string>;
};

const TEMPLATE_TITLE_PREFIX = "自己紹介シート";

export function parseNotionMarkdown(
  text: string,
  filePath: string,
): NotionPage | null {
  const lines = text.split(/\r?\n/);

  let title = "";
  let titleIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^#\s+(.+?)\s*$/);
    if (m) {
      title = m[1]!.trim();
      titleIdx = i;
      break;
    }
  }
  if (!title || title.startsWith(TEMPLATE_TITLE_PREFIX)) return null;

  const properties = parseProperties(lines, titleIdx + 1);
  const comment = extractAside(text);
  const tableCells = parseTables(lines);

  return { filePath, title, properties, comment, tableCells };
}

function parseProperties(
  lines: string[],
  start: number,
): Record<string, string> {
  const props: Record<string, string> = {};
  let i = start;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") break;
    if (line.startsWith("#") || line.startsWith("|") || line.startsWith("![")) break;
    const m = line.match(/^([^:]+?)\s*:\s*(.*)$/);
    if (!m) break;
    props[m[1]!.trim()] = m[2]!.trim();
  }
  return props;
}

function extractAside(text: string): string | null {
  const m = text.match(/<aside>([\s\S]*?)<\/aside>/);
  if (!m) return null;
  const inner = m[1]!.trim();
  return inner.length > 0 ? inner : null;
}

function parseTables(lines: string[]): Record<string, string> {
  const cells: Record<string, string> = {};
  let buffer: string[] = [];
  let inRow = false;

  const flush = () => {
    if (buffer.length === 0) {
      inRow = false;
      return;
    }
    const joined = buffer.join("\n");
    buffer = [];
    inRow = false;
    const cellsArr = splitRowCells(joined);
    if (cellsArr.length < 2) return;
    if (isSeparatorRow(cellsArr)) return;
    const key = cellsArr[0]!.trim();
    const value = cellsArr.slice(1).join(" | ").trim();
    if (key.length === 0) return;
    if (key in cells) return;
    cells[key] = value;
  };

  for (const line of lines) {
    if (!inRow) {
      if (line.startsWith("|")) {
        buffer.push(line);
        inRow = true;
        if (rtrim(line).endsWith("|")) flush();
      }
      continue;
    }
    if (line.startsWith("#")) {
      flush();
      continue;
    }
    buffer.push(line);
    if (rtrim(line).endsWith("|")) flush();
  }
  flush();
  return cells;
}

function splitRowCells(rowText: string): string[] {
  let s = rowText;
  s = s.replace(/^\s*\|/, "");
  s = s.replace(/\|\s*$/, "");
  return s.split("|").map((c) => c.replace(/^\s+|\s+$/g, ""));
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

function rtrim(s: string): string {
  return s.replace(/\s+$/, "");
}
