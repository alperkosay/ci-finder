import { ApiError, encodeId, type CiFinderClient } from "@ci-finder/core/client";

export type UploadFolder = string | { volume: string; path: string };

/**
 * Resolves the id of the upload folder, creating missing folders along the path. The usual case
 * (the folder exists) costs one request.
 */
export async function ensureFolder(client: CiFinderClient, setting: UploadFolder): Promise<string> {
  const { volumes } = await client.init();
  const { volume, path } = typeof setting === "string" ? { volume: volumes[0]!.id, path: setting } : setting;
  const segments = path.split("/").filter(Boolean);
  const target = encodeId(volume, "/" + segments.join("/"));
  try {
    await client.ls(target);
    return target;
  } catch (e) {
    if (!(e instanceof ApiError && e.code === "NOT_FOUND")) throw e;
  }
  let current = encodeId(volume, "/");
  let currentPath = "";
  for (const segment of segments) {
    try {
      await client.mkdir(current, segment);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "EXISTS")) throw e;
    }
    currentPath += `/${segment}`;
    current = encodeId(volume, currentPath);
  }
  return current;
}
