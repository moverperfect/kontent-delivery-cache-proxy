import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export async function atomicWriteFile(
  finalPath: string,
  data: string | Buffer,
  options?: { encoding?: BufferEncoding },
): Promise<void> {
  const dir = dirname(finalPath);
  await mkdir(dir, { recursive: true });
  const tmpName = `.${randomBytes(8).toString("hex")}.tmp`;
  const tmpPath = join(dir, tmpName);
  try {
    await writeFile(tmpPath, data, options);
    await rename(tmpPath, finalPath);
  } catch (e) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw e;
  }
}
