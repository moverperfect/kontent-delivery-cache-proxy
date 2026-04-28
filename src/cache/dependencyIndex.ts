import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppConfig } from "../config.js";
import { atomicWriteFile } from "../utils/atomicWrite.js";
import { isoNow } from "../utils/time.js";
import { withFileLock } from "./lockManager.js";

export interface DependencyIndexRecord {
  dependencyKey: string;
  cacheKeys: string[];
  updatedAt: string;
}

export function dependencyKeyToRelativePath(dependencyKey: string): string {
  const idx = dependencyKey.indexOf(":");
  if (idx === -1) {
    return join("deps", "misc", `${sanitizeSegment(dependencyKey)}.json`);
  }
  const ns = sanitizeSegment(dependencyKey.slice(0, idx));
  const rest = dependencyKey.slice(idx + 1);
  const fname = `${sanitizeSegment(rest)}.json`;
  return join("deps", ns, fname);
}

function sanitizeSegment(s: string): string {
  const t = s.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (t.length > 0 ? t : "x").slice(0, 200);
}

export function dependencyIndexAbsolutePath(config: AppConfig, dependencyKey: string): string {
  return join(config.CACHE_DIR, dependencyKeyToRelativePath(dependencyKey));
}

async function readRecord(path: string): Promise<DependencyIndexRecord | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as DependencyIndexRecord;
    if (
      typeof parsed.dependencyKey === "string" &&
      Array.isArray(parsed.cacheKeys) &&
      typeof parsed.updatedAt === "string"
    ) {
      return parsed;
    }
  } catch {
    /* missing or corrupt */
  }
  return undefined;
}

async function touchLockCompanion(lockPath: string): Promise<void> {
  await writeFile(lockPath, Buffer.alloc(0), { flag: "a" }).catch(() => {});
}

export async function addCacheKeyToDependencyIndexes(
  config: AppConfig,
  dependencyKeys: string[],
  cacheKey: string,
): Promise<void> {
  for (const dk of dependencyKeys) {
    const abs = dependencyIndexAbsolutePath(config, dk);
    await mkdir(dirname(abs), { recursive: true });
    const lockPath = `${abs}.lock`;
    await touchLockCompanion(lockPath);
    await withFileLock(lockPath, async () => {
      const existing = await readRecord(abs);
      const set = new Set(existing?.cacheKeys ?? []);
      set.add(cacheKey);
      const record: DependencyIndexRecord = {
        dependencyKey: dk,
        cacheKeys: [...set].sort(),
        updatedAt: isoNow(),
      };
      await atomicWriteFile(abs, JSON.stringify(record, null, 2));
    });
  }
}

export async function removeCacheKeyFromDependencyIndexes(
  config: AppConfig,
  dependencyKeys: string[],
  cacheKey: string,
): Promise<void> {
  for (const dk of dependencyKeys) {
    const abs = dependencyIndexAbsolutePath(config, dk);
    const lockPath = `${abs}.lock`;
    await touchLockCompanion(lockPath);
    await withFileLock(lockPath, async () => {
      const existing = await readRecord(abs);
      if (!existing) return;
      const next = existing.cacheKeys.filter((k) => k !== cacheKey);
      if (next.length === 0) {
        try {
          await unlink(abs);
        } catch {
          /* ignore */
        }
        return;
      }
      const record: DependencyIndexRecord = {
        ...existing,
        cacheKeys: next.sort(),
        updatedAt: isoNow(),
      };
      await atomicWriteFile(abs, JSON.stringify(record, null, 2));
    });
  }
}

export async function getCacheKeysForDependency(
  config: AppConfig,
  dependencyKey: string,
): Promise<string[]> {
  const abs = dependencyIndexAbsolutePath(config, dependencyKey);
  const rec = await readRecord(abs);
  return rec?.cacheKeys ?? [];
}

export async function readDependencyRecord(
  config: AppConfig,
  dependencyKey: string,
): Promise<DependencyIndexRecord | undefined> {
  const abs = dependencyIndexAbsolutePath(config, dependencyKey);
  return readRecord(abs);
}
