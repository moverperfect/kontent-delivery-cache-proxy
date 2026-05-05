import { describe, expect, it } from "vitest";
import {
  CacheSaveConcurrencyLimiter,
  CacheSaveWindowLimiter,
} from "../../src/cache/cacheSaveRateLimiter.js";

describe("CacheSaveWindowLimiter", () => {
  it("allows up to maxPerWindow reservations within window", () => {
    const w = new CacheSaveWindowLimiter(1000, 2);
    expect(w.tryReserve(100)).toEqual({ ok: true, token: 100 });
    expect(w.tryReserve(200)).toEqual({ ok: true, token: 200 });
    expect(w.tryReserve(300)).toEqual({ ok: false });
  });

  it("prunes entries older than windowMs", () => {
    const w = new CacheSaveWindowLimiter(1000, 1);
    expect(w.tryReserve(1000)).toEqual({ ok: true, token: 1000 });
    expect(w.tryReserve(1500)).toEqual({ ok: false });
    expect(w.tryReserve(2001)).toEqual({ ok: true, token: 2001 });
  });

  it("releaseLastReserved frees a slot for matching token", () => {
    const w = new CacheSaveWindowLimiter(1000, 1);
    expect(w.tryReserve(100)).toEqual({ ok: true, token: 100 });
    expect(w.tryReserve(200)).toEqual({ ok: false });
    w.releaseLastReserved(100);
    expect(w.tryReserve(200)).toEqual({ ok: true, token: 200 });
  });

  it("release removes matching token, not pop()-last (strands wrong entry if pop)", () => {
    const w = new CacheSaveWindowLimiter(1000, 2);
    expect(w.tryReserve(100)).toEqual({ ok: true, token: 100 });
    expect(w.tryReserve(200)).toEqual({ ok: true, token: 200 });
    w.releaseLastReserved(100);
    w.releaseLastReserved(200);
    expect(w.tryReserve(300)).toEqual({ ok: true, token: 300 });
    expect(w.tryReserve(400)).toEqual({ ok: true, token: 400 });
    expect(w.tryReserve(500)).toEqual({ ok: false });
  });

  it("maxPerWindow 0 is no-op limit", () => {
    const w = new CacheSaveWindowLimiter(1000, 0);
    expect(w.tryReserve(100)).toEqual({ ok: true });
    expect(w.tryReserve(100)).toEqual({ ok: true });
    w.releaseLastReserved(100);
  });
});

describe("CacheSaveConcurrencyLimiter", () => {
  it("allows at most maxConcurrent acquisitions", () => {
    const s = new CacheSaveConcurrencyLimiter(2);
    expect(s.tryAcquire()).toBe(true);
    expect(s.tryAcquire()).toBe(true);
    expect(s.tryAcquire()).toBe(false);
    s.release();
    expect(s.tryAcquire()).toBe(true);
  });

  it("maxConcurrent 0 means no limit", () => {
    const s = new CacheSaveConcurrencyLimiter(0);
    expect(s.tryAcquire()).toBe(true);
    expect(s.tryAcquire()).toBe(true);
    s.release();
  });
});
