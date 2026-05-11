import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildShuffleHistoryWorkbook,
  defaultHistoryPath,
  HISTORY_DIR,
  type ShuffleHistoryPayload,
} from "./excel-builder";

export { defaultHistoryPath, HISTORY_DIR };
export type { ShuffleHistoryPayload };

export async function writeShuffleHistory(
  payload: ShuffleHistoryPayload,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const wb = buildShuffleHistoryWorkbook(payload);
  const buf = await wb.xlsx.writeBuffer();
  await Bun.write(outputPath, buf);
}
