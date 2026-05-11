import { test, expect } from "bun:test";
import { nameKeys, NameIndex } from "./match";

test("japanese-only name", () => {
  expect(nameKeys("磯山 博文")).toEqual(["ja:磯山博文"]);
});

test("japanese + english", () => {
  const k = nameKeys("山本 萌　Moe Yamamoto");
  expect(k).toContain("ja:山本萌");
  expect(k).toContain("en:moeyamamoto");
});

test("latin-only name", () => {
  expect(nameKeys("Zhang Zhibin")).toContain("en:zhangzhibin");
});

test("japanese + parens-wrapped english", () => {
  const k = nameKeys("石田 宗道（ishida munemichi）");
  expect(k).toContain("ja:石田宗道");
  expect(k).toContain("en:ishidamunemichi");
});

test("truncated name still keys on japanese without paren noise", () => {
  const k = nameKeys("若谷 貴史（Takashi Wakayaな");
  expect(k).toContain("ja:若谷貴史");
  expect(k).toContain("en:takashiwakaya");
});

test("name with japanese inside parens", () => {
  const k = nameKeys("Zhang Zhibin（張 智斌）");
  expect(k).toContain("en:zhangzhibin");
  expect(k).toContain("ja:張智斌");
});

test("kanji variant folding (髙→高)", () => {
  const a = new NameIndex([{ name: "高柳 魁斗" }], (m) => m.name);
  expect(a.find("髙柳魁斗")?.name).toBe("高柳 魁斗");
});

test("kanji variant folding (曾→曽)", () => {
  const a = new NameIndex([{ name: "曾 驍" }], (m) => m.name);
  expect(a.find("曽 驍")?.name).toBe("曾 驍");
});

test("english word order", () => {
  const a = new NameIndex([{ name: "Ergun Ugurcan" }], (m) => m.name);
  expect(a.find("Ugurcan Ergun")?.name).toBe("Ergun Ugurcan");
});

test("full-width spaces handled, kanji folded", () => {
  const k = nameKeys("中澤綾乃　Ayano Nakazawa");
  expect(k).toContain("ja:中沢綾乃"); // 澤 folded to 沢
  expect(k).toContain("en:ayanonakazawa");
});

test("name index roundtrip", () => {
  const idx = new NameIndex(
    [{ name: "磯山 博文" }, { name: "Zhang Zhibin（張 智斌）" }],
    (m) => m.name,
  );
  expect(idx.find("磯山博文")?.name).toBe("磯山 博文");
  expect(idx.find("Zhang Zhibin")?.name).toBe("Zhang Zhibin（張 智斌）");
  expect(idx.find("張 智斌")?.name).toBe("Zhang Zhibin（張 智斌）");
  expect(idx.find("Nobody")).toBeNull();
});
