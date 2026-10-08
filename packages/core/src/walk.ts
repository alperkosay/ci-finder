import { mapLimit } from "./stream";
import type { DriverStat, StorageDriver, VolumePath } from "./types";

/**
 * Lists everything below `root` straight from the driver, hidden and internal folders included.
 * Uses the driver's flat search when it has one (a single paged listing on S3), otherwise walks
 * the tree level by level. Stops after `limit` items.
 */
export async function walkAll(driver: StorageDriver, root: VolumePath, limit = 500_000): Promise<{ items: DriverStat[]; truncated: boolean }> {
  if (!(await driver.stat(root))) return { items: [], truncated: false };
  if (driver.search) {
    const items = await driver.search(root, () => true, limit);
    return { items, truncated: items.length >= limit };
  }
  const items: DriverStat[] = [];
  let level: VolumePath[] = [root];
  while (level.length && items.length < limit) {
    const next: VolumePath[] = [];
    await mapLimit(level, 8, async (dir) => {
      let children: DriverStat[];
      try {
        children = await driver.list(dir);
      } catch {
        return; // vanished or unreadable while walking
      }
      for (const s of children) {
        items.push(s);
        if (s.kind === "dir") next.push(s.path);
      }
    });
    level = next;
  }
  return { items: items.slice(0, limit), truncated: items.length >= limit };
}
