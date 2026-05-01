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

### Azure App Service SSH

The container image includes OpenSSH on port `2222` for the Azure App Service SSH console flow described in the Microsoft guide for Linux custom containers.

- `sshd_config` is checked into the repo root with the Azure-required ciphers, MACs, and `Port 2222`.
- `entrypoint.sh` starts `sshd` before launching the Node app.
- The image exposes both `8080` for HTTP and `2222` for the App Service SSH bridge.
- The image uses the required `root` password of `Docker!` for App Service's internal SSH handshake.

This is only intended for App Service's built-in SSH console path; the container still serves the app on `PORT`/`8080` as normal.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Run with `tsx` watch |
| `pnpm run build` | Compile to `dist/` |
| `pnpm start` | Run `dist/index.js` |
| `pnpm test` | Vitest unit + integration tests |
