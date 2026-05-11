export const MEMBERS_FILE = "members.xlsx";
export const NOTION_CSV =
  "import/自己紹介ページ 2a23cc2a2b4380a69067d0fabae4a780.csv";
export const NOTION_DIR = "import/自己紹介ページ";

export const LOAD_PROFILES_ARGS = {
  membersFile: MEMBERS_FILE,
  notionCsv: NOTION_CSV,
  notionDir: NOTION_DIR,
} as const;
