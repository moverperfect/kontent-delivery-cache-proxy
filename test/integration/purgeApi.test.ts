import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapIntegrationServer,
  disposeIntegrationServer,
  kontentListJson,
  type IntegrationHarness,
} from "./helpers/integrationSetup.js";

describe("purge API auth and validation", () => {
  let app: FastifyInstance;
  let cacheDir: string;

  beforeEach(async () => {
    const h: IntegrationHarness = await bootstrapIntegrationServer({
      purgeToken: "purge-secret",
      fetchMock: vi.fn(async () => {
        return new Response(kontentListJson([{ codename: "solo", type: "article" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });
    app = h.app;
    cacheDir = h.cacheDir;
  });

  afterEach(async () => {
    await disposeIntegrationServer(app, cacheDir);
  });

  it("401 when Authorization is missing", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/internal/purge",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ dependencies: ["item:solo"], mode: "delete" }),
    });
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body)).toMatchObject({ error: "unauthorized" });
  });

  it("401 when Bearer token is wrong", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/internal/purge",
      headers: {
        authorization: "Bearer wrong",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ dependencies: ["item:solo"], mode: "delete" }),
    });
    expect(r.statusCode).toBe(401);
  });

  it("400 invalid_body when mode is not a valid enum value", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/internal/purge",
      headers: {
        authorization: "Bearer purge-secret",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        dependencies: ["item:solo"],
        mode: "rename",
      }),
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body)).toMatchObject({ error: "invalid_body" });
  });

  it("400 invalid_body when dependency string is empty", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/internal/purge",
      headers: {
        authorization: "Bearer purge-secret",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        dependencies: [""],
      }),
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body)).toMatchObject({ error: "invalid_body" });
  });

  it("400 warm_disabled when mode is delete-and-warm but warm is not enabled", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/internal/purge",
      headers: {
        authorization: "Bearer purge-secret",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        dependencies: ["item:solo"],
        mode: "delete-and-warm",
      }),
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body)).toMatchObject({ error: "warm_disabled" });
  });
});

describe("soft-expire purge mode", () => {
  let app: FastifyInstance;
  let cacheDir: string;

  beforeEach(async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      const body =
        n === 1
          ? kontentListJson([{ codename: "foo", type: "article" }])
          : kontentListJson([{ codename: "bar", type: "article" }]);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const h: IntegrationHarness = await bootstrapIntegrationServer({
      purgeToken: "purge-secret",
      fetchMock,
    });
    app = h.app;
    cacheDir = h.cacheDir;
  });

  afterEach(async () => {
    await disposeIntegrationServer(app, cacheDir);
  });

  it("deletes indexed cache like delete mode (parity until soft-expire semantics differ)", async () => {
    await app.inject({
      method: "GET",
      url: "/delivery/prod/items?a=1&language=en-GB",
    });

    const purge = await app.inject({
      method: "POST",
      url: "/internal/purge",
      headers: {
        authorization: "Bearer purge-secret",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        dependencies: ["item:foo"],
        mode: "soft-expire",
      }),
    });

    expect(purge.statusCode).toBe(200);
    const body = JSON.parse(purge.body) as { deleted: string[] };
    expect(body.deleted.length).toBe(1);

    const next = await app.inject({
      method: "GET",
      url: "/delivery/prod/items?a=1&language=en-GB",
    });
    expect(next.headers["x-kontent-proxy-cache"]).toBe("MISS");
  });
});
