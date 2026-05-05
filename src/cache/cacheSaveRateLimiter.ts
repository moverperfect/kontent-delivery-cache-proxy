/**
 * Sliding-window limit on how many cache saves may start within windowMs.
 * maxPerWindow <= 0 disables the limit (tryReserve always succeeds with ok, no token).
 *
 * On success with the limit enabled, pass tryReserve's token to releaseLastReserved on failure
 * so the correct slot is removed under concurrency (same millisecond twice is rare; indexOf
 * would drop the first match).
 */
export type CacheSaveWindowReserveResult =
  | { ok: true; token: number }
  | { ok: true }
  | { ok: false };

export class CacheSaveWindowLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly windowMs: number,
    private readonly maxPerWindow: number,
  ) {}

  tryReserve(now: number): CacheSaveWindowReserveResult {
    if (this.maxPerWindow <= 0) return { ok: true };
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.timestamps.length && this.timestamps[i]! < cutoff) {
      i++;
    }
    if (i > 0) {
      this.timestamps.splice(0, i);
    }
    if (this.timestamps.length >= this.maxPerWindow) return { ok: false };
    this.timestamps.push(now);
    return { ok: true, token: now };
  }

  releaseLastReserved(token: number): void {
    if (this.maxPerWindow <= 0) return;
    const i = this.timestamps.indexOf(token);
    if (i >= 0) {
      this.timestamps.splice(i, 1);
    }
  }
}

/**
 * Limits concurrent in-flight cache saves.
 * maxConcurrent <= 0 disables the limit (tryAcquire always true).
 */
export class CacheSaveConcurrencyLimiter {
  private inFlight = 0;

  constructor(private readonly maxConcurrent: number) {}

  tryAcquire(): boolean {
    if (this.maxConcurrent <= 0) return true;
    if (this.inFlight >= this.maxConcurrent) return false;
    this.inFlight++;
    return true;
  }

  release(): void {
    if (this.maxConcurrent <= 0) return;
    if (this.inFlight > 0) {
      this.inFlight--;
    }
  }
}
