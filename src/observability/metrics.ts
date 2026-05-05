import type { AppConfig } from "../config.js";

export type CacheStatusLabel = "HIT" | "MISS" | "STALE" | "REFRESH" | "BYPASS" | "ERROR";

export class Metrics {
  requestsTotal = 0;
  cacheHitsTotal = 0;
  cacheMissesTotal = 0;
  cacheStaleTotal = 0;
  refreshTotal = 0;
  upstreamRequestsTotal = 0;
  upstreamErrorsTotal = 0;
  purgeRequestsTotal = 0;
  purgedObjectsTotal = 0;
  cacheSaveSkippedConcurrentTotal = 0;
  cacheSaveSkippedWindowTotal = 0;
  cacheSaveCompletedTotal = 0;
  cacheSaveDurationMsSum = 0;

  recordRequest(cacheStatus: CacheStatusLabel): void {
    this.requestsTotal++;
    if (cacheStatus === "HIT") this.cacheHitsTotal++;
    else if (cacheStatus === "MISS") this.cacheMissesTotal++;
    else if (cacheStatus === "STALE") this.cacheStaleTotal++;
    else if (cacheStatus === "REFRESH") this.refreshTotal++;
  }

  recordCacheSaveSkipConcurrent(): void {
    this.cacheSaveSkippedConcurrentTotal++;
  }

  recordCacheSaveSkipWindow(): void {
    this.cacheSaveSkippedWindowTotal++;
  }

  recordCacheSaveComplete(durationMs: number): void {
    this.cacheSaveCompletedTotal++;
    this.cacheSaveDurationMsSum += durationMs;
  }

  prometheusText(_config: AppConfig): string {
    const lines: string[] = [];
    const help = (n: string, h: string) => {
      lines.push(`# HELP ${n} ${h}`);
      lines.push(`# TYPE ${n} counter`);
    };
    help("kontent_proxy_requests_total", "Total proxy requests");
    lines.push(`kontent_proxy_requests_total ${this.requestsTotal}`);
    help("kontent_proxy_cache_hits_total", "Cache hits");
    lines.push(`kontent_proxy_cache_hits_total ${this.cacheHitsTotal}`);
    help("kontent_proxy_cache_misses_total", "Cache misses");
    lines.push(`kontent_proxy_cache_misses_total ${this.cacheMissesTotal}`);
    help("kontent_proxy_cache_stale_total", "Stale responses served");
    lines.push(`kontent_proxy_cache_stale_total ${this.cacheStaleTotal}`);
    help("kontent_proxy_upstream_requests_total", "Upstream Kontent requests");
    lines.push(`kontent_proxy_upstream_requests_total ${this.upstreamRequestsTotal}`);
    help("kontent_proxy_upstream_errors_total", "Upstream errors");
    lines.push(`kontent_proxy_upstream_errors_total ${this.upstreamErrorsTotal}`);
    help("kontent_proxy_purge_requests_total", "Purge API calls");
    lines.push(`kontent_proxy_purge_requests_total ${this.purgeRequestsTotal}`);
    help("kontent_proxy_purged_objects_total", "Objects purged");
    lines.push(`kontent_proxy_purged_objects_total ${this.purgedObjectsTotal}`);
    help("kontent_proxy_cache_save_skipped_concurrent_total", "Cache persist skipped: concurrency limit");
    lines.push(`kontent_proxy_cache_save_skipped_concurrent_total ${this.cacheSaveSkippedConcurrentTotal}`);
    help("kontent_proxy_cache_save_skipped_window_total", "Cache persist skipped: sliding window limit");
    lines.push(`kontent_proxy_cache_save_skipped_window_total ${this.cacheSaveSkippedWindowTotal}`);
    help("kontent_proxy_cache_save_completed_total", "Completed cache persist calls");
    lines.push(`kontent_proxy_cache_save_completed_total ${this.cacheSaveCompletedTotal}`);
    help("kontent_proxy_cache_save_duration_ms_sum", "Sum of cache persist durations in ms");
    lines.push(`kontent_proxy_cache_save_duration_ms_sum ${this.cacheSaveDurationMsSum}`);
    return lines.join("\n") + "\n";
  }
}
