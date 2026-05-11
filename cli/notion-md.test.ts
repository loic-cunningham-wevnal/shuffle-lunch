import { test, expect } from "bun:test";
import { parseNotionMarkdown } from "./notion-md";

test("parses title, properties, aside, tables", () => {
  const md = `# 山田 太郎 (Taro Yamada)

部署: Dev
生年月日: January 15, 1997
誕生月_Flag: No

![image.png](path/to/img.png)

## ✍️ ひとことコメント

<aside>

よろしくお願いします！

</aside>

---

| 部署 | Form Dev |
| --- | --- |
| 役職 | Tech Lead |
| 出身地 | 東京 |

---

### 💻 仕事において…

| 得意なこと | デバッグ |
| --- | --- |
| 苦手なこと | プレゼン |
`;
  const page = parseNotionMarkdown(md, "fake.md");
  expect(page).not.toBeNull();
  expect(page!.title).toBe("山田 太郎 (Taro Yamada)");
  expect(page!.properties).toEqual({
    "部署": "Dev",
    "生年月日": "January 15, 1997",
    "誕生月_Flag": "No",
  });
  expect(page!.comment).toBe("よろしくお願いします！");
  expect(page!.tableCells["部署"]).toBe("Form Dev");
  expect(page!.tableCells["役職"]).toBe("Tech Lead");
  expect(page!.tableCells["出身地"]).toBe("東京");
  expect(page!.tableCells["得意なこと"]).toBe("デバッグ");
  expect(page!.tableCells["苦手なこと"]).toBe("プレゼン");
});

test("multi-line cell preserves newlines", () => {
  const md = `# A B

| 趣味 | ロック
└メタル系

サッカー |
`;
  const page = parseNotionMarkdown(md, "x.md");
  expect(page!.tableCells["趣味"]).toBe("ロック\n└メタル系\n\nサッカー");
});

test("template title returns null", () => {
  const md = `# 自己紹介シート（タイトルは氏名に変更）

最終更新日時: March 3, 2026 6:50 PM
`;
  expect(parseNotionMarkdown(md, "tpl.md")).toBeNull();
});

test("empty aside is null", () => {
  const md = `# A B

部署: Dev

## comment

<aside>

</aside>
`;
  expect(parseNotionMarkdown(md, "x.md")!.comment).toBeNull();
});

test("colon-after-spaces in property", () => {
  const md = `# A B

年齢（自動動入力）: 29 歳
`;
  expect(parseNotionMarkdown(md, "x.md")!.properties["年齢（自動動入力）"]).toBe("29 歳");
});
