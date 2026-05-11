import { test, expect } from "bun:test";
import { loadFlatMembers, FlatMemberSchema } from "./profiles";
import { z } from "zod";

const ARGS = {
  membersFile: "members.xlsx",
  notionCsv:
    "import/自己紹介ページ 2a23cc2a2b4380a69067d0fabae4a780.csv",
  notionDir: "import/自己紹介ページ",
};

test("e2e: loads, matches and validates all members", async () => {
  const { members, unmatched } = await loadFlatMembers(ARGS);

  expect(members.length).toBe(174);
  z.array(FlatMemberSchema).parse(members);

  // "with notion data" = anything that requires CSV/MD lookup populated something.
  const withNotion = members.filter(
    (m) =>
      m.detailed_department ||
      m.job_title ||
      m.hobbies ||
      m.comment ||
      m.surprising_fact ||
      m.hometown ||
      m.age !== null ||
      m.joined_year !== null,
  ).length;
  expect(withNotion).toBeGreaterThan(120);

  console.log(
    `[e2e] members=${members.length} withNotion=${withNotion} unmatchedCsv=${unmatched.csvNames.length} unmatchedPage=${unmatched.pageTitles.length}`,
  );
});

test("e2e: known profile fully populated (森近 楓)", async () => {
  const { members } = await loadFlatMembers(ARGS);
  const m = members.find((m) => m.name.includes("森近"));
  expect(m).toBeDefined();
  expect(m!.department).toBe("BOTCHAN Form Dev");
  expect(m!.age).toBe(28);
  expect(m!.detailed_department).toBe("Form Dev");
  expect(m!.job_title).toBe("Tech Lead");
  expect(m!.hometown).toBe("愛知県");
  expect(m!.hobbies).toBe("バスケ");
  expect(m!.comment).toBe("よろしくお願いします！");
});

test("e2e: known profile (原 滉介) has multi-line cells", async () => {
  const { members } = await loadFlatMembers(ARGS);
  const m = members.find((m) => m.name.includes("原") && m.name.includes("滉介"));
  expect(m).toBeDefined();
  expect(m!.detailed_department).toBe("Keeper・AICALL");
  expect(m!.job_title).toBe("リーダー");
  expect(m!.hobbies).toContain("ロック");
  expect(m!.hobbies).toContain("サッカー");
  expect(m!.hobbies).toContain("ギター");
});

test("e2e: latin-only excel name matches notion data", async () => {
  const { members } = await loadFlatMembers(ARGS);
  const m = members.find((m) => m.name === "Zhang Zhibin");
  expect(m).toBeDefined();
});

test("e2e: members without notion data still appear with null fields", async () => {
  const { members } = await loadFlatMembers(ARGS);
  const noNotion = members.filter(
    (m) =>
      !m.detailed_department &&
      !m.job_title &&
      !m.hobbies &&
      !m.comment &&
      !m.surprising_fact &&
      !m.hometown &&
      m.age === null &&
      m.joined_year === null,
  );
  expect(noNotion.length).toBeGreaterThan(0);
  for (const m of noNotion) {
    expect(m.no).toBeGreaterThan(0);
    expect(m.name.length).toBeGreaterThan(0);
  }
});

test("e2e: name_romaji parses Latin run from Notion", async () => {
  const { members } = await loadFlatMembers(ARGS);
  // 久川 徹 has Romaji "Toru Kyukawa" in his Notion page title.
  const m = members.find((m) => m.no === 2);
  expect(m).toBeDefined();
  expect(m!.name_romaji).toMatch(/[A-Za-z]/);
});

test("e2e: joined_year parsed as number when present", async () => {
  const { members } = await loadFlatMembers(ARGS);
  const withYear = members.filter((m) => m.joined_year !== null);
  expect(withYear.length).toBeGreaterThan(50);
  for (const m of withYear) {
    expect(m.joined_year).toBeGreaterThanOrEqual(2000);
    expect(m.joined_year).toBeLessThanOrEqual(2100);
  }
});
