import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/config.js";
import {
  addCacheKeyToDependencyIndexes,
  dependencyIndexAbsolutePath,
  getCacheKeysForDependency,
  removeCacheKeyFromDependencyIndexes,
} from "../../src/cache/dependencyIndex.js";

describe("dependency index", () => {
  let dir: string;
  let config: AppConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kc-proxy-"));
    await mkdir(join(dir, "deps"), { recursive: true });
    config = {
      CACHE_DIR: dir,
    } as AppConfig;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("adds cache key idempotently", async () => {
    await addCacheKeyToDependencyIndexes(config, ["item:foo"], "abc123");
    await addCacheKeyToDependencyIndexes(config, ["item:foo"], "abc123");
    const keys = await getCacheKeysForDependency(config, "item:foo");
    expect(keys).toEqual(["abc123"]);
  });

  it("removes cache key from index", async () => {
    await addCacheKeyToDependencyIndexes(config, ["item:foo"], "abc123");
    await removeCacheKeyFromDependencyIndexes(config, ["item:foo"], "abc123");
    const keys = await getCacheKeysForDependency(config, "item:foo");
    expect(keys).toEqual([]);
  });

  it("writes readable JSON", async () => {
    await addCacheKeyToDependencyIndexes(config, ["type:article"], "key1");
    const abs = dependencyIndexAbsolutePath(config, "type:article");
    const raw = await readFile(abs, "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      dependencyKey: "type:article",
      cacheKeys: ["key1"],
    });
  });
});
