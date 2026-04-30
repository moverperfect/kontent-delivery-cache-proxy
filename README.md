# Kontent.ai dependency-aware cache proxy

HTTP proxy for [Kontent.ai](https://kontent.ai) Delivery API that caches JSON responses on disk, tracks dependency keys derived from payloads and queries, and supports webhook-driven purge via authenticated internal APIs.

See `docs/product-design-document.md` for goals, security model, and cache semantics.

## Quick start

```bash
pnpm install
export PURGE_TOKEN="replace-with-long-random-secret"
export CACHE_DIR="./.cache-proxy"
pnpm run dev
```

Health:

```http
GET http://localhost:8080/healthz
```

Delivery traffic (maps to Kontent Delivery host):

```http
GET http://localhost:8080/delivery/<environmentId>/items?language=en-GB
```

Preview uses `/preview/:environmentId/*` and `KONTENT_PREVIEW_BASE_URL`.

## Configuration

Important environment variables:

| Variable | Purpose |
|----------|---------|
| `PURGE_TOKEN` | Bearer token for `/internal/*` |
| `CACHE_DIR` | Writable cache root |
| `KONTENT_DELIVERY_BASE_URL` | Default `https://deliver.kontent.ai` |
| `CACHE_DEFAULT_TTL_SECONDS` | Fresh expiry |
| `UPSTREAM_WAIT_FOR_NEW_CONTENT` | Sends `X-KC-Wait-For-Loading-New-Content` on upstream misses |
| `DEBUG_HEADERS` | Exposes `X-Kontent-Proxy-Cache-Key` when `true` |

Full list matches section 10 of the product design document.

## Docker

```bash
docker compose up --build
```

Set `PURGE_TOKEN` in `docker-compose.yml` (or override via env). It is required in all environments.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Run with `tsx` watch |
| `pnpm run build` | Compile to `dist/` |
| `pnpm start` | Run `dist/index.js` |
| `pnpm test` | Vitest unit + integration tests |

## Application Insights observability

Set `APPLICATIONINSIGHTS_CONNECTION_STRING` to enable Azure Application Insights. Optional controls:
- `APPINSIGHTS_ENABLED` (default: true when connection string exists)
- `APPINSIGHTS_SAMPLING_PERCENTAGE` (0-100, default 100)
- `APPINSIGHTS_ROLE_NAME` (default `kontent-cache-proxy`)
- `APPINSIGHTS_ENABLE_REQUEST_TRACKING` (default true)
- `APPINSIGHTS_ENABLE_DEPENDENCY_TRACKING` (default true)
- `APPINSIGHTS_ENABLE_AVAILABILITY_TRACKING` (default true)
- `APPINSIGHTS_TRACK_HEALTH_ENDPOINTS` (default false)
- `APPINSIGHTS_REDACT_QUERY_VALUES` (default true)

### Correlation and telemetry
- Inbound `traceparent`/`tracestate` are honored when present.
- Outbound upstream calls propagate W3C trace headers.
- Request/dependency/availability/exception telemetry is emitted with cache dimensions (`cacheStatus`, `environmentId`, `mode`, `proxyRequestId`, `upstreamDurationMs`).
- Logs include `traceId`, `spanId`, `parentSpanId`, and `requestId` for incident debugging.

### Cost and sampling guidance
- Start with `APPINSIGHTS_SAMPLING_PERCENTAGE=25` in high-throughput environments.
- Keep `APPINSIGHTS_REDACT_QUERY_VALUES=true` to reduce accidental PII collection.
- Keep health endpoint tracking disabled unless you need availability trend charts.
