import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import { atomicWriteFile } from "../utils/atomicWrite.js";
import { sha256Hex } from "../utils/hashing.js";
import { isoNow, addSeconds } from "../utils/time.js";
import type { CacheMetadata } from "./cacheMetadata.js";
import {
  addCacheKeyToDependencyIndexes,
  removeCacheKeyFromDependencyIndexes,
} from "./dependencyIndex.js";

export function objectDirForCacheKey(cacheKey: string): string {
  const prefix = cacheKey.slice(0, 2);
  return join("objects", prefix);
}

export function bodyRelativePath(cacheKey: string): string {
  return join(objectDirForCacheKey(cacheKey), `${cacheKey}.body.json`);
}

export function metaRelativePath(cacheKey: string): string {
  return join(objectDirForCacheKey(cacheKey), `${cacheKey}.meta.json`);
}

export async function readMetadata(
  config: AppConfig,
  cacheKey: string,
): Promise<CacheMetadata | undefined> {
  const abs = join(config.CACHE_DIR, metaRelativePath(cacheKey));
  try {
    const raw = await readFile(abs, "utf8");
    return JSON.parse(raw) as CacheMetadata;
  } catch {
    return undefined;
  }
}

export async function readBodyBuffer(
  config: AppConfig,
  cacheKey: string,
): Promise<Buffer | undefined> {
  const meta = await readMetadata(config, cacheKey);
  if (!meta) return undefined;
  const abs = join(config.CACHE_DIR, meta.bodyFile);
  try {
    return await readFile(abs);
  } catch {
    return undefined;
  }
}

export interface StoreCacheObjectParams {
  config: AppConfig;
  cacheKey: string;
  canonicalKeyInput: string;
  method: string;
  environmentId: string;
  mode: "delivery" | "preview";
  upstreamUrl: string;
  requestHeadersForReplay: Record<string, string>;
  status: number;
  responseHeaders: Record<string, string>;
  body: Buffer;
  dependencyKeys: string[];
  ttlSeconds: number;
  staleWhileRevalidateSeconds: number;
}

export async function storeCacheObject(params: StoreCacheObjectParams): Promise<CacheMetadata> {
  const {
    config,
    cacheKey,
    canonicalKeyInput,
    method,
    environmentId,
    mode,
    upstreamUrl,
    requestHeadersForReplay,
    status,
    responseHeaders,
    body,
    dependencyKeys,
    ttlSeconds,
    staleWhileRevalidateSeconds,
  } = params;

  const existing = await readMetadata(config, cacheKey);
  const now = isoNow();
  const hashHex = sha256Hex(body);

  const relBody = bodyRelativePath(cacheKey);
  const absBody = join(config.CACHE_DIR, relBody);
  const absMeta = join(config.CACHE_DIR, metaRelativePath(cacheKey));

  await mkdir(join(config.CACHE_DIR, objectDirForCacheKey(cacheKey)), { recursive: true });

  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(responseHeaders)) {
    lowerHeaders[k.toLowerCase()] = v;
  }

  const sortedDeps = [...dependencyKeys].sort();
  const meta: CacheMetadata = {
    schemaVersion: 1,
    cacheKey,
    method,
    environmentId,
    mode,
    upstreamUrl,
    canonicalKeyInput,
    requestHeadersForReplay,
    status,
    responseHeaders: lowerHeaders,
    bodyFile: relBody.replace(/\\/g, "/"),
    bodySha256: hashHex,
    bodySizeBytes: body.byteLength,
    createdAt: existing?.createdAt ?? now,
    refreshedAt: now,
    expiresAt: addSeconds(now, ttlSeconds),
    staleUntil: addSeconds(now, ttlSeconds + staleWhileRevalidateSeconds),
    dependencyKeys: sortedDeps,
  };

  await atomicWriteFile(absBody, body);
  await atomicWriteFile(absMeta, JSON.stringify(meta, null, 2));

  if (existing) {
    const prevSet = new Set(existing.dependencyKeys);
    const nextSet = new Set(sortedDeps);
    const removed = existing.dependencyKeys.filter((d) => !nextSet.has(d));
    const added = sortedDeps.filter((d) => !prevSet.has(d));
    if (removed.length > 0) {
      await removeCacheKeyFromDependencyIndexes(config, removed, cacheKey);
    }
    if (added.length > 0) {
      await addCacheKeyToDependencyIndexes(config, added, cacheKey);
    }
  } else {
    await addCacheKeyToDependencyIndexes(config, sortedDeps, cacheKey);
  }

  return meta;
}

export async function deleteCacheObject(config: AppConfig, cacheKey: string): Promise<boolean> {
  const meta = await readMetadata(config, cacheKey);
  if (!meta) return false;

  await removeCacheKeyFromDependencyIndexes(config, meta.dependencyKeys, cacheKey);

  const absBody = join(config.CACHE_DIR, meta.bodyFile);
  const absMeta = join(config.CACHE_DIR, metaRelativePath(cacheKey));
  try {
    await unlink(absBody);
  } catch {
    /* ignore */
  }
  try {
    await unlink(absMeta);
  } catch {
    /* ignore */
  }
  return true;
}
