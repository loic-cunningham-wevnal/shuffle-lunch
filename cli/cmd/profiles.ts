import { loadEnrichedMembers } from "./load";

export async function runProfiles(): Promise<void> {
  const { members, unmatched, cachedEnrichmentCount } =
    await loadEnrichedMembers();
  console.log(JSON.stringify(members, null, 2));
  const withNotion = members.filter(
    (m) => m.detailed_department || m.hobbies || m.comment || m.surprising_fact || m.hometown,
  ).length;
  process.stderr.write(
    `\nTotal: ${members.length} | Notion: ${withNotion} | Enriched: ${cachedEnrichmentCount}\n`,
  );
  if (unmatched.csvNames.length > 0 || unmatched.pageTitles.length > 0) {
    process.stderr.write(
      `Unmatched Notion entries (skipped): csv=${unmatched.csvNames.length}, md=${unmatched.pageTitles.length}\n`,
    );
  }
}
