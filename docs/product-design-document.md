# Product Design Document: Kontent.ai Dependency-Aware Cache Proxy

## 1. Summary

Build a custom TypeScript HTTP proxy that sits between the website and Kontent.ai Delivery API. The proxy will cache Kontent API responses, extract dependency metadata from those responses, and support webhook-driven cache invalidation by content item codename, content type, taxonomy, and synthetic query dependencies.

The primary purpose is to reduce repeated calls to Kontent.ai, avoid stale-content rehydration after content updates, and provide a testable Layer 3 cache beneath the website’s rendered-page cache.

The proxy should be designed as a standalone Dockerized service that can run locally, in a container platform, or behind Cloudflare Tunnel/private networking.

---

## 2. Context

The production website is deployed to Cloudflare Workers and uses Kontent.ai as the content backend. HTML is already cached at Cloudflare, but frequent deployments and Cloudflare’s distributed cache behaviour cause repeated cache misses across locations. Those misses can cause repeated calls to Kontent.ai for the same content.

A rendered-page cache in R2 is being considered as a Layer 2 cache. This proxy represents an additional Layer 3 cache between the site and Kontent.ai.

The proposed cache hierarchy is:

```text
L1: Cloudflare edge HTML cache
L2: R2 rendered page cache
L3: Kontent.ai dependency-aware response cache proxy
Origin: Kontent.ai Delivery API
```

This document describes the L3 proxy.

---

## 3. Goals

### 3.1 Primary Goals

1. Proxy Kontent.ai Delivery API requests from the website.
2. Cache successful Kontent.ai API responses on disk.
3. Generate stable cache keys from request method, path, query string, environment, and relevant headers/body.
4. Add `X-KC-Wait-For-Loading-New-Content: true` to upstream Kontent.ai requests when fetching or refreshing content.
5. Parse cached JSON responses to extract dependency keys.
6. Maintain a reverse dependency index from dependency key to cached response keys.
7. Expose internal purge endpoints so webhooks can invalidate cached responses by dependency key.
8. Support optional purge-and-warm behaviour by replaying previously cached requests after invalidation.
9. Provide observability through structured logs, health endpoints, metrics, and cache inspection endpoints.
10. Run as a Docker container with persistent cache storage.

### 3.2 Secondary Goals

1. Support both REST Delivery API and GraphQL-style requests if required.
2. Support stale-while-revalidate behaviour.
3. Support stale-if-error behaviour when Kontent.ai is unavailable.
4. Support multiple Kontent environments without cache contamination.
5. Support production and preview modes without cache contamination.
6. Allow easy integration tests with mocked Kontent.ai responses.

---

## 4. Non-Goals

1. This proxy does not replace the Cloudflare HTML cache.
2. This proxy does not replace the proposed R2 rendered-page cache.
3. This proxy does not render pages.
4. This proxy does not make content freshness decisions for HTML pages.
5. This proxy does not implement a CMS webhook receiver for every Kontent event type unless explicitly configured.
6. This proxy does not attempt to automatically infer all possible website route dependencies.
7. This proxy does not cache non-Kontent arbitrary internet requests.
8. This proxy does not mutate Kontent.ai response bodies.

---

## 5. High-Level Architecture

```text
Website / renderer
    |
    | HTTP request shaped like Kontent Delivery API
    v
Kontent Cache Proxy
    |
    | Cache hit
    v
Local file cache

Kontent Cache Proxy
    |
    | Cache miss / refresh
    v
Kontent.ai Delivery API
```

Webhook invalidation flow:

```text
Kontent webhook processor
    |
    | POST /internal/purge
    v
Kontent Cache Proxy
    |
    | dependency key lookup
    v
Reverse dependency index
    |
    | delete matching cached objects
    v
Local file cache
```

Optional warm flow:

```text
POST /internal/purge { mode: "delete-and-warm" }
    |
    v
Delete affected cache files
    |
    v
Replay previous upstream requests
    |
    v
Fetch fresh responses from Kontent.ai
    |
    v
Store new cache files and dependency index entries
```

---

## 6. Core Concepts

### 6.1 Cache Object

A cache object is a stored upstream response from Kontent.ai.

It consists of:

- response body file
- metadata file
- dependency keys
- request replay metadata
- timestamps
- status code
- response headers

### 6.2 Dependency Key

A dependency key is a logical tag that describes what a cached response depends on.

Examples:

```text
item:chelsea_flower_show
type:article
taxonomy:plant_group:roses
query:items:type:article
language:en-GB
environment:production
```

Dependency keys are used for invalidation.

### 6.3 Reverse Dependency Index

A reverse dependency index maps dependency keys to cache keys.

Example:

```json
{
  "dependencyKey": "item:chelsea_flower_show",
  "cacheKeys": [
    "6e1ab1e2...",
    "a891fc33..."
  ],
  "updatedAt": "2026-04-27T18:22:11.000Z"
}
```

### 6.4 Synthetic Dependencies

Synthetic dependencies are dependency keys not directly derived from response item codenames.

Examples:

```text
type:article
query:items:type:article
query:path:/items
language:en-GB
```

These are important because some cached responses may be affected by content that was not present in the old response.

Example: a listing query for the latest articles may need invalidating when a new article is published, even though the new article codename was not in the previously cached response.

---

## 7. Functional Requirements

## 7.1 Proxy REST Requests

The proxy must accept HTTP requests from the website and forward them to Kontent.ai.

Example local request:

```http
GET /delivery/prod/items?system.type=article&depth=3&language=en-GB
```

Example upstream request:

```http
GET https://deliver.kontent.ai/prod/items?system.type=article&depth=3&language=en-GB
X-KC-Wait-For-Loading-New-Content: true
```

The environment segment should be configurable. The proxy should support both path-based and environment-variable-based mapping.

Supported methods for MVP:

```text
GET
HEAD
```

Optional later methods:

```text
POST for GraphQL
```

---

## 7.2 Build Stable Cache Keys

The proxy must generate deterministic cache keys.

The cache key must include:

```text
HTTP method
Kontent environment ID
Upstream path
Sorted query string
Relevant request headers
Preview/production mode
Authorization token identity, if used
Request body hash for POST requests
Proxy cache schema version
```

Example canonical key input:

```text
v1|GET|env:prod|mode:delivery|path:/items|query:depth=3&language=en-GB&system.type=article
```

The final cache key should be a SHA-256 hash of the canonical input.

Example:

```text
6e1ab1e2976afcc1c8f7d1a0d7f8e3c71f9e...
```

Query string order must not affect the cache key.

These two requests must map to the same cache key:

```text
/items?language=en-GB&depth=3
/items?depth=3&language=en-GB
```

---

## 7.3 Cache Successful Responses

The proxy should cache upstream responses that meet all of these criteria:

```text
HTTP method is cacheable
Status code is cacheable
Content-Type is supported
Request is not explicitly bypassed
Response is not too large for configured limits
```

Default cacheable status codes:

```text
200
203
300
301
404
```

The proxy should not cache by default:

```text
401
403
429
500
502
503
504
```

404 caching should be configurable.

---

## 7.4 Upstream Freshness Header

For all upstream fetches that are cache misses or forced refreshes, the proxy should send:

```http
X-KC-Wait-For-Loading-New-Content: true
```

This should be configurable but enabled by default.

This header should not cause every site request to call Kontent.ai. Cached hits should be served locally without upstream calls.

---

## 7.5 File-Based Cache Storage

MVP storage should be local filesystem storage.

Example directory structure:

```text
/var/cache/kontent-proxy/
  objects/
    6e/
      6e1ab1e2.body.json
      6e1ab1e2.meta.json
  deps/
    item/
      chelsea_flower_show.json
    type/
      article.json
    query/
      items_type_article.json
  locks/
    6e1ab1e2.lock
  tmp/
  manifests/
    cache-manifest.json
```

Writes must be atomic:

```text
1. Write to tmp file
2. fsync if practical
3. Rename into final path
4. Update metadata
5. Update dependency indexes
```

The implementation should avoid leaving partial body/meta pairs behind.

---

## 7.6 Metadata File Format

Each cached response should have a metadata file.

Example:

```json
{
  "schemaVersion": 1,
  "cacheKey": "6e1ab1e2976afcc1c8f7d1a0d7f8e3c71f9e",
  "method": "GET",
  "environmentId": "prod",
  "mode": "delivery",
  "upstreamUrl": "https://deliver.kontent.ai/prod/items?depth=3&language=en-GB&system.type=article",
  "canonicalKeyInput": "v1|GET|env:prod|mode:delivery|path:/items|query:depth=3&language=en-GB&system.type=article",
  "requestHeadersForReplay": {},
  "status": 200,
  "responseHeaders": {
    "content-type": "application/json"
  },
  "bodyFile": "objects/6e/6e1ab1e2976afcc1c8f7d1a0d7f8e3c71f9e.body.json",
  "bodySha256": "...",
  "bodySizeBytes": 123456,
  "createdAt": "2026-04-27T18:22:11.000Z",
  "refreshedAt": "2026-04-27T18:22:11.000Z",
  "expiresAt": "2026-04-28T18:22:11.000Z",
  "staleUntil": "2026-04-29T18:22:11.000Z",
  "dependencyKeys": [
    "item:chelsea_flower_show",
    "item:venue_info",
    "type:article",
    "query:items:type:article",
    "language:en-GB"
  ]
}
```

---

## 7.7 Dependency Extraction

The proxy must parse JSON responses and extract dependency keys.

For Kontent Delivery API REST responses, inspect:

```text
items[*].system.codename
items[*].system.type
modular_content.*.system.codename
modular_content.*.system.type
items[*].elements.* taxonomies where present
modular_content.*.elements.* taxonomies where present
```

Minimum extracted dependencies:

```text
item:<codename>
type:<type>
language:<language>
environment:<environmentId>
```

Recommended synthetic dependencies:

```text
query:path:<normalised-path>
query:items:type:<system.type>
query:items:codename:<system.codename>
query:items:collection:<collection>
query:items:taxonomy:<taxonomy-group>:<taxonomy-term>
```

The synthetic dependency generation rules should be explicit and test-covered.

Pseudo-code:

```ts
function extractDependencyKeys(response: unknown, context: RequestContext): string[] {
  const deps = new Set<string>();

  deps.add(`environment:${context.environmentId}`);

  if (context.language) {
    deps.add(`language:${context.language}`);
  }

  deps.add(`query:path:${context.normalisedPath}`);

  for (const item of getKontentItems(response)) {
    if (item.system?.codename) {
      deps.add(`item:${item.system.codename}`);
    }

    if (item.system?.type) {
      deps.add(`type:${item.system.type}`);
    }
  }

  for (const synthetic of deriveSyntheticQueryDeps(context)) {
    deps.add(synthetic);
  }

  return [...deps].sort();
}
```

---

## 7.8 Reverse Dependency Index Updates

When a response is cached, the proxy must update indexes for every dependency key.

Example:

```text
item:chelsea_flower_show → cacheKeyA, cacheKeyB
type:article → cacheKeyA, cacheKeyC
query:items:type:article → cacheKeyA
```

Index updates should be safe under concurrent requests.

MVP approach:

```text
Use per-dependency lock files during index update.
Read existing index JSON.
Add/remove cache key.
Write updated index atomically.
```

The proxy should also remove stale references to deleted cache objects where practical.

---

## 7.9 Purge Endpoint

The proxy must expose an internal purge endpoint.

```http
POST /internal/purge
Authorization: Bearer <PURGE_TOKEN>
Content-Type: application/json
```

Request body:

```json
{
  "dependencies": [
    "item:chelsea_flower_show",
    "type:article"
  ],
  "mode": "delete",
  "reason": "kontent-webhook",
  "requestId": "optional-correlation-id"
}
```

Supported modes:

```text
delete
soft-expire
delete-and-warm
```

MVP must support:

```text
delete
```

Optional v1 should support:

```text
delete-and-warm
```

Response body:

```json
{
  "requestId": "optional-correlation-id",
  "dependencies": [
    "item:chelsea_flower_show"
  ],
  "matchedCacheKeys": [
    "6e1ab1e2..."
  ],
  "deleted": [
    "6e1ab1e2..."
  ],
  "warmed": [],
  "errors": []
}
```

---

## 7.10 Warm Endpoint

The proxy should expose an optional warm endpoint.

```http
POST /internal/warm
Authorization: Bearer <PURGE_TOKEN>
Content-Type: application/json
```

Request body:

```json
{
  "cacheKeys": [
    "6e1ab1e2..."
  ],
  "dependencies": [
    "item:chelsea_flower_show"
  ],
  "requestId": "optional-correlation-id"
}
```

Behaviour:

```text
1. Resolve previous request metadata from cache keys.
2. Replay the original request against Kontent.ai.
3. Include X-KC-Wait-For-Loading-New-Content: true.
4. Store the new response using the same cache key rules.
5. Rebuild dependency indexes.
```

For MVP, this may be implemented later.

---

## 7.11 Bypass and Force Refresh

The proxy should support internal bypass/refresh controls.

Recommended request headers:

```http
X-Kontent-Proxy-Bypass: true
X-Kontent-Proxy-Refresh: true
```

Rules:

```text
Bypass:
  Do not read from cache.
  Do not write to cache unless explicitly configured.

Refresh:
  Do not read from cache.
  Fetch upstream.
  Write new cache object.
  Return fresh response.
```

These headers must only be honoured when the request is authenticated as internal.

Public website traffic should not be able to force refresh.

---

## 7.12 Stale Serving

The proxy should support three states:

```text
fresh:
  Return cached response.

stale:
  Return cached response and optionally refresh in background.

expired:
  Block on upstream refresh before responding.
```

Configuration:

```text
CACHE_DEFAULT_TTL_SECONDS
CACHE_STALE_WHILE_REVALIDATE_SECONDS
CACHE_STALE_IF_ERROR_SECONDS
```

MVP can implement simple fresh/expired only.

---

## 7.13 Request Coalescing

When multiple identical cache misses occur concurrently, the proxy should only make one upstream Kontent.ai request.

MVP implementation:

```text
Use a per-cache-key in-memory promise map.
```

Container-local only is acceptable for MVP.

Later implementation:

```text
Use filesystem lock files for cross-process safety.
```

---

## 7.14 Error Handling

If upstream fetch fails and a stale cached response exists, return stale response when within configured stale-if-error period.

If no cached response exists, return upstream error response.

Error responses should include proxy diagnostic headers in non-production or when enabled:

```http
X-Kontent-Proxy-Cache: MISS
X-Kontent-Proxy-Error: upstream_fetch_failed
X-Kontent-Proxy-Request-Id: ...
```

---

## 8. API Design

## 8.1 Delivery Proxy Endpoint

```http
GET /delivery/:environmentId/*
```

Example:

```http
GET /delivery/prod/items?system.type=article&language=en-GB&depth=3
```

Maps to:

```http
GET https://deliver.kontent.ai/prod/items?system.type=article&language=en-GB&depth=3
```

Response headers added by proxy:

```http
X-Kontent-Proxy-Cache: HIT | MISS | STALE | BYPASS | REFRESH
X-Kontent-Proxy-Cache-Key: <cache-key-if-debug-enabled>
X-Kontent-Proxy-Dependencies: <optional truncated dependency list if debug-enabled>
X-Kontent-Proxy-Upstream-Duration-Ms: <number>
X-Kontent-Proxy-Request-Id: <correlation-id>
```

`X-Kontent-Proxy-Cache-Key` and dependency headers should be disabled by default in production if they are considered sensitive.

---

## 8.2 Health Endpoint

```http
GET /healthz
```

Response:

```json
{
  "status": "ok",
  "service": "kontent-cache-proxy",
  "version": "0.1.0"
}
```

---

## 8.3 Readiness Endpoint

```http
GET /readyz
```

Checks:

```text
Cache directory readable
Cache directory writable
Required environment variables present
Optional upstream connectivity check if enabled
```

Response:

```json
{
  "status": "ready",
  "checks": {
    "cacheDirReadable": true,
    "cacheDirWritable": true,
    "configValid": true
  }
}
```

---

## 8.4 Purge Endpoint

```http
POST /internal/purge
```

Authentication required.

Request:

```json
{
  "dependencies": ["item:foo"],
  "mode": "delete",
  "reason": "kontent-webhook",
  "requestId": "abc-123"
}
```

Response:

```json
{
  "requestId": "abc-123",
  "matchedCacheKeys": ["..."],
  "deleted": ["..."],
  "errors": []
}
```

---

## 8.5 Cache Inspection Endpoint

```http
GET /internal/cache/:cacheKey/meta
```

Authentication required.

Returns metadata for a cached object.

---

## 8.6 Dependency Inspection Endpoint

```http
GET /internal/deps/:dependencyKey
```

Authentication required.

Example:

```http
GET /internal/deps/item:chelsea_flower_show
```

Response:

```json
{
  "dependencyKey": "item:chelsea_flower_show",
  "cacheKeys": ["6e1ab1e2..."],
  "updatedAt": "2026-04-27T18:22:11.000Z"
}
```

---

## 9. Security Requirements

### 9.1 Internal Endpoints

All `/internal/*` endpoints must require authentication.

MVP authentication:

```http
Authorization: Bearer <PURGE_TOKEN>
```

The token must be provided via environment variable.

### 9.2 Refresh Controls

Headers that force bypass or refresh must not be honoured from unauthenticated public requests.

### 9.3 Token Handling

If Kontent Delivery API tokens are used, they must not be logged.

The proxy should redact:

```text
Authorization
X-KC-Secured-Production-Api-Key
X-KC-Secured-Preview-Api-Key
```

### 9.4 Cache Separation

The cache key must separate:

```text
production vs preview
environment IDs
secured vs unsecured requests
language variants
request bodies
```

Failure to do this could cause content leakage.

---

## 10. Configuration

Environment variables:

```text
PORT=8080
NODE_ENV=production
LOG_LEVEL=info

KONTENT_DELIVERY_BASE_URL=https://deliver.kontent.ai
KONTENT_PREVIEW_BASE_URL=https://preview-deliver.kontent.ai

CACHE_DIR=/var/cache/kontent-proxy
CACHE_SCHEMA_VERSION=1
CACHE_DEFAULT_TTL_SECONDS=86400
CACHE_STALE_WHILE_REVALIDATE_SECONDS=3600
CACHE_STALE_IF_ERROR_SECONDS=86400
CACHE_MAX_BODY_BYTES=10485760
CACHE_404_RESPONSES=true

UPSTREAM_WAIT_FOR_NEW_CONTENT=true
UPSTREAM_TIMEOUT_MS=30000
UPSTREAM_RETRY_COUNT=2
UPSTREAM_RETRY_BACKOFF_MS=500

PURGE_TOKEN=change-me
DEBUG_HEADERS=false

ENABLE_WARM_ENDPOINT=false
ENABLE_GRAPHQL=false
```

---

## 11. Docker Design

Example `docker-compose.yml`:

```yaml
services:
  kontent-cache-proxy:
    build: .
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      NODE_ENV: "production"
      LOG_LEVEL: "info"
      KONTENT_DELIVERY_BASE_URL: "https://deliver.kontent.ai"
      CACHE_DIR: "/var/cache/kontent-proxy"
      CACHE_DEFAULT_TTL_SECONDS: "86400"
      CACHE_STALE_WHILE_REVALIDATE_SECONDS: "3600"
      CACHE_STALE_IF_ERROR_SECONDS: "86400"
      UPSTREAM_WAIT_FOR_NEW_CONTENT: "true"
      PURGE_TOKEN: "replace-this"
      DEBUG_HEADERS: "false"
    volumes:
      - kontent_cache:/var/cache/kontent-proxy
    restart: unless-stopped

volumes:
  kontent_cache:
```

---

## 12. Suggested Repository Structure

```text
kontent-cache-proxy/
  src/
    index.ts
    server.ts
    config.ts

    routes/
      deliveryProxyRoute.ts
      healthRoute.ts
      internalPurgeRoute.ts
      internalWarmRoute.ts
      internalInspectRoute.ts

    cache/
      cacheKey.ts
      fileCacheStore.ts
      cacheMetadata.ts
      dependencyIndex.ts
      cachePolicy.ts
      lockManager.ts

    kontent/
      upstreamClient.ts
      dependencyExtractor.ts
      queryDependencyExtractor.ts
      kontentTypes.ts

    security/
      auth.ts
      redaction.ts

    observability/
      logger.ts
      metrics.ts
      requestContext.ts

    utils/
      canonicalUrl.ts
      hashing.ts
      atomicWrite.ts
      json.ts
      time.ts

  test/
    unit/
      cacheKey.test.ts
      dependencyExtractor.test.ts
      queryDependencyExtractor.test.ts
      dependencyIndex.test.ts
      fileCacheStore.test.ts
    integration/
      proxyCacheHitMiss.test.ts
      purgeByDependency.test.ts
      staleIfError.test.ts
      requestCoalescing.test.ts

  docker/
    Dockerfile

  docker-compose.yml
  package.json
  tsconfig.json
  README.md
```

---

## 13. Implementation Guidance

### 13.1 Recommended Runtime

Use Node.js with TypeScript.

Recommended HTTP framework:

```text
Fastify
```

Reasons:

```text
Good TypeScript support
Fast request lifecycle
Easy route-level hooks
Good plugin ecosystem
Easy structured logging with pino
```

### 13.2 Recommended Libraries

```text
fastify
pino
zod
undici
proper-lockfile or custom lock files
vitest
nock or msw for upstream mocking
```

Use `undici` or native `fetch` for upstream HTTP calls.

---

## 14. Cache Key Algorithm

Function signature:

```ts
interface CacheKeyInput {
  schemaVersion: number;
  method: string;
  environmentId: string;
  mode: 'delivery' | 'preview';
  path: string;
  query: URLSearchParams;
  varyHeaders: Record<string, string>;
  bodySha256?: string;
}

interface CacheKeyResult {
  canonicalInput: string;
  cacheKey: string;
}
```

Rules:

```text
1. Uppercase method.
2. Lowercase header names.
3. Sort query parameters by key, then value.
4. Preserve duplicate query parameters.
5. Do not include volatile headers.
6. Include auth identity hash if auth affects response.
7. Hash canonical input with SHA-256.
```

---

## 15. Dependency Extraction Algorithm

Function signature:

```ts
interface DependencyExtractionContext {
  environmentId: string;
  mode: 'delivery' | 'preview';
  path: string;
  query: URLSearchParams;
  language?: string;
}

function extractDependencyKeys(
  responseBody: unknown,
  context: DependencyExtractionContext
): string[];
```

Rules:

```text
1. Always include environment dependency.
2. Always include path/query synthetic dependency.
3. Include language dependency if language is present.
4. Extract item codenames from items array.
5. Extract item codenames from modular_content object.
6. Extract content types from both items and modular_content.
7. Extract taxonomy terms where feasible.
8. Generate synthetic query dependencies from known query params.
9. Sort and de-duplicate keys.
```

Example output:

```json
[
  "environment:prod",
  "item:chelsea_flower_show",
  "item:venue_info",
  "language:en-GB",
  "query:path:/items",
  "query:items:type:article",
  "type:article"
]
```

---

## 16. Webhook Integration Contract

This service does not need to receive Kontent webhooks directly in MVP. Instead, another service or Worker can translate webhooks into purge requests.

Expected translation:

Kontent changed item:

```json
{
  "codename": "chelsea_flower_show",
  "type": "article",
  "language": "en-GB"
}
```

Proxy purge request:

```json
{
  "dependencies": [
    "item:chelsea_flower_show",
    "type:article",
    "language:en-GB",
    "query:items:type:article"
  ],
  "mode": "delete",
  "reason": "kontent-webhook"
}
```

The webhook translator should include broad synthetic dependencies when appropriate.

Example: when an article is published, include:

```text
item:<codename>
type:article
query:items:type:article
```

This ensures article listing queries are invalidated even if the changed article was not in the previously cached response.

---

## 17. Observability

### 17.1 Logs

Use structured JSON logs.

Each request log should include:

```text
requestId
method
path
statusCode
cacheStatus
cacheKey if debug enabled
durationMs
upstreamDurationMs
upstreamStatusCode
errorCode
```

Cache statuses:

```text
HIT
MISS
STALE
REFRESH
BYPASS
ERROR
```

### 17.2 Metrics

Expose Prometheus-style metrics at:

```http
GET /metrics
```

Suggested metrics:

```text
kontent_proxy_requests_total
kontent_proxy_cache_hits_total
kontent_proxy_cache_misses_total
kontent_proxy_cache_stale_total
kontent_proxy_upstream_requests_total
kontent_proxy_upstream_errors_total
kontent_proxy_purge_requests_total
kontent_proxy_purged_objects_total
kontent_proxy_cache_objects_total
kontent_proxy_cache_size_bytes
kontent_proxy_request_duration_ms
kontent_proxy_upstream_duration_ms
```

MVP can log these before implementing full Prometheus output.

---

## 18. Testing Requirements

### 18.1 Unit Tests

#### Cache Key Tests

1. Same query params in different order produce same key.
2. Different environment IDs produce different keys.
3. Preview and delivery modes produce different keys.
4. Different request body hashes produce different POST keys.
5. Relevant vary headers affect keys.

#### Dependency Extraction Tests

1. Extracts `items[*].system.codename`.
2. Extracts `items[*].system.type`.
3. Extracts `modular_content.*.system.codename`.
4. Extracts `modular_content.*.system.type`.
5. Adds synthetic query dependencies.
6. Deduplicates dependencies.
7. Handles empty or malformed JSON safely.

#### Dependency Index Tests

1. Adds cache key to dependency index.
2. Removes cache key from dependency index.
3. Handles duplicate additions idempotently.
4. Handles missing index file.
5. Handles stale cache key references.

---

### 18.2 Integration Tests

#### Test: Cache Hit/Miss

```text
1. Mock Kontent response.
2. Request proxy URL.
3. Assert upstream called once.
4. Request same proxy URL again.
5. Assert upstream not called.
6. Assert second response has X-Kontent-Proxy-Cache: HIT.
```

#### Test: Freshness Header

```text
1. Request uncached URL.
2. Assert upstream request includes X-KC-Wait-For-Loading-New-Content: true.
```

#### Test: Purge by Item Codename

```text
1. Cache response containing item:foo.
2. Cache response containing item:bar.
3. POST /internal/purge with dependency item:foo.
4. Assert foo response deleted.
5. Assert bar response remains.
```

#### Test: Listing Query Synthetic Dependency

```text
1. Cache /items?system.type=article.
2. Assert dependency query:items:type:article exists.
3. Purge query:items:type:article.
4. Assert listing cache deleted.
```

#### Test: Stale If Error

```text
1. Cache response.
2. Mark it stale but within stale-if-error window.
3. Make upstream return 500.
4. Assert stale cached response is returned.
```

#### Test: Request Coalescing

```text
1. Fire 10 concurrent requests for same uncached URL.
2. Assert upstream called once.
3. Assert all requests receive same response.
```

---

## 19. MVP Scope

The MVP should include:

```text
Fastify TypeScript server
GET Delivery API proxy endpoint
Stable cache key generation
Local file cache
Metadata files
Dependency extraction from items and modular_content
Reverse dependency indexes
Bearer-authenticated purge endpoint
Health and readiness endpoints
Structured logs
Dockerfile
Unit tests
Core integration tests
```

MVP may exclude:

```text
GraphQL support
Prometheus metrics
Warm endpoint
Stale-while-revalidate
Advanced taxonomy extraction
Multi-process lock safety
Cache size eviction
Admin UI
```

---

## 20. Post-MVP Enhancements

1. `delete-and-warm` purge mode.
2. Stale-while-revalidate.
3. Stale-if-error.
4. GraphQL POST caching.
5. Cache size limits and LRU eviction.
6. Prometheus metrics.
7. Admin inspection UI.
8. Redis/R2/Azure Blob storage backend.
9. Durable lock backend for multiple replicas.
10. Automatic webhook receiver for Kontent.ai.
11. Dependency extraction plugin system.
12. Support for surrogate key headers if used behind Varnish/CDN later.

---

## 21. Known Risks and Mitigations

### Risk: Cache key contamination

If the cache key omits environment, mode, token identity, language, or body hash, the proxy may serve incorrect content.

Mitigation:

```text
Strict cache key tests.
Separate delivery/preview modes.
Fail closed for unknown auth modes.
```

### Risk: Incomplete dependency extraction

A response can be affected by content that was not in the old response, especially listing queries.

Mitigation:

```text
Use synthetic dependencies from query params.
Purge broad type/query dependencies from webhook translator.
Add manual purge-all endpoint for emergencies.
```

### Risk: Local disk not shared across replicas

Multiple proxy containers would have independent caches.

Mitigation:

```text
MVP supports single replica.
Document this clearly.
Later add shared storage backend or route consistently to one instance.
```

### Risk: Filesystem corruption or partial writes

Crashes during writes could leave partial cache objects.

Mitigation:

```text
Atomic write via tmp + rename.
Validate body/meta pair before serving.
Periodic cache repair command later.
```

### Risk: Upstream slowness due to freshness header

Using the freshness header on every upstream miss could increase miss latency.

Mitigation:

```text
Serve cached responses normally.
Use request coalescing.
Add warm jobs after purge.
Add stale-if-error.
```

### Risk: Purge endpoint abuse

Unauthorised purge could delete cache or cause upstream load.

Mitigation:

```text
Bearer auth.
Network-level protection.
Rate limits.
Audit logs.
```

---

## 22. Acceptance Criteria

The implementation is acceptable when:

1. The service can run locally via Docker Compose.
2. The website can make a Kontent-style request through the proxy.
3. The first request is a cache miss and calls mocked/upstream Kontent.
4. The second identical request is a cache hit and does not call Kontent.
5. Cache files are written to disk with metadata.
6. Dependency index files are created from response JSON.
7. A purge request by `item:<codename>` deletes the relevant cached responses.
8. Query string order does not cause duplicate cache entries.
9. Upstream requests include `X-KC-Wait-For-Loading-New-Content: true` by default.
10. Internal endpoints require authentication.
11. Unit and integration tests pass in CI.
12. The Docker image starts successfully and exposes `/healthz`.

---

## 23. Example End-to-End Scenario

### Step 1: Site requests content

```http
GET http://kontent-cache-proxy:8080/delivery/prod/items?system.type=article&language=en-GB&depth=3
```

### Step 2: Proxy cache miss

Proxy generates cache key:

```text
6e1ab1e2...
```

Proxy fetches upstream:

```http
GET https://deliver.kontent.ai/prod/items?depth=3&language=en-GB&system.type=article
X-KC-Wait-For-Loading-New-Content: true
```

### Step 3: Proxy stores response

Files created:

```text
objects/6e/6e1ab1e2.body.json
objects/6e/6e1ab1e2.meta.json
deps/type/article.json
deps/item/chelsea_flower_show.json
deps/query/items_type_article.json
```

### Step 4: Second site request

Same request returns:

```http
X-Kontent-Proxy-Cache: HIT
```

No upstream Kontent.ai call is made.

### Step 5: Kontent webhook says article changed

Webhook translator calls:

```http
POST /internal/purge
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "dependencies": [
    "item:chelsea_flower_show",
    "type:article",
    "query:items:type:article"
  ],
  "mode": "delete",
  "reason": "kontent-webhook"
}
```

### Step 6: Proxy deletes matching cached responses

The next site render will fetch fresh data through the proxy.

If warm mode is enabled, the proxy can immediately replay the previous requests and refill the cache before user traffic needs them.

---

## 24. Build Order for Implementing Agent

Recommended build sequence:

1. Scaffold TypeScript/Fastify project.
2. Add config loading and validation.
3. Add health and readiness endpoints.
4. Implement canonical URL/query normalisation.
5. Implement cache key hashing.
6. Implement local file cache read/write.
7. Implement upstream Kontent client.
8. Implement GET proxy route.
9. Add cache hit/miss headers.
10. Implement dependency extractor.
11. Implement dependency index writes.
12. Implement authenticated purge endpoint.
13. Add integration tests for hit/miss and purge.
14. Add Dockerfile and docker-compose.
15. Add documentation and usage examples.
16. Add optional stale-if-error and warm endpoint.

---

## 25. Open Questions

1. Should the proxy support preview content from day one?
2. Will secured Delivery API tokens be passed through the proxy?
3. Will the proxy run as a single replica initially?
4. Should the webhook translator live inside this service or remain separate?
5. Which query patterns are most important to model for synthetic dependencies?
6. Should the cache persist indefinitely until purged, or should TTL expiry be mandatory?
7. Should cache warming be part of MVP or a follow-up?
8. What is the maximum expected Kontent response size?
9. Should failed purge operations block downstream Cloudflare cache purging?
10. Should the proxy emit dependency keys as headers for debugging or for downstream cache tagging?

