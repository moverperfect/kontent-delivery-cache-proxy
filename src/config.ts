import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  KONTENT_DELIVERY_BASE_URL: z.string().url().default("https://deliver.kontent.ai"),
  KONTENT_PREVIEW_BASE_URL: z
    .string()
    .url()
    .default("https://preview-deliver.kontent.ai"),

  CACHE_DIR: z.string().default("./.cache-proxy"),
  CACHE_SCHEMA_VERSION: z.coerce.number().int().positive().default(1),
  CACHE_DEFAULT_TTL_SECONDS: z.coerce.number().int().min(0).default(86400),
  CACHE_STALE_WHILE_REVALIDATE_SECONDS: z.coerce.number().int().min(0).default(3600),
  CACHE_STALE_IF_ERROR_SECONDS: z.coerce.number().int().min(0).default(86400),
  CACHE_MAX_BODY_BYTES: z.coerce.number().int().positive().default(10485760),
  CACHE_404_RESPONSES: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),

  UPSTREAM_WAIT_FOR_NEW_CONTENT: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  UPSTREAM_RETRY_COUNT: z.coerce.number().int().min(0).default(2),
  UPSTREAM_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).default(500),

  PURGE_TOKEN: z.string().min(1),
  DEBUG_HEADERS: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  ENABLE_WARM_ENDPOINT: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  ENABLE_GRAPHQL: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
  APPINSIGHTS_ENABLED: z.string().optional().transform((v) => v !== "false" && v !== "0"),
  APPINSIGHTS_SAMPLING_PERCENTAGE: z.coerce.number().min(0).max(100).default(100),
  APPINSIGHTS_ROLE_NAME: z.string().default("kontent-cache-proxy"),
  APPINSIGHTS_ENABLE_REQUEST_TRACKING: z.string().optional().transform((v) => v !== "false" && v !== "0"),
  APPINSIGHTS_ENABLE_DEPENDENCY_TRACKING: z.string().optional().transform((v) => v !== "false" && v !== "0"),
  APPINSIGHTS_ENABLE_AVAILABILITY_TRACKING: z.string().optional().transform((v) => v !== "false" && v !== "0"),
  APPINSIGHTS_TRACK_HEALTH_ENDPOINTS: z.string().optional().transform((v) => v === "true" || v === "1"),
  APPINSIGHTS_REDACT_QUERY_VALUES: z.string().optional().transform((v) => v !== "false" && v !== "0"),
});

export type AppConfig = Omit<z.infer<typeof envSchema>, "PURGE_TOKEN"> & {
  PURGE_TOKEN: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid configuration: ${JSON.stringify(msg)}`);
  }
  const data = parsed.data;
  const purgeToken = data.PURGE_TOKEN.trim();

  return {
    ...data,
    PURGE_TOKEN: purgeToken,
    CACHE_404_RESPONSES: data.CACHE_404_RESPONSES ?? true,
    UPSTREAM_WAIT_FOR_NEW_CONTENT: data.UPSTREAM_WAIT_FOR_NEW_CONTENT ?? true,
    DEBUG_HEADERS: data.DEBUG_HEADERS ?? false,
    ENABLE_WARM_ENDPOINT: data.ENABLE_WARM_ENDPOINT ?? false,
    ENABLE_GRAPHQL: data.ENABLE_GRAPHQL ?? false,
    APPINSIGHTS_ENABLED:
      data.APPINSIGHTS_ENABLED ?? Boolean(data.APPLICATIONINSIGHTS_CONNECTION_STRING),
    APPINSIGHTS_ENABLE_REQUEST_TRACKING: data.APPINSIGHTS_ENABLE_REQUEST_TRACKING ?? true,
    APPINSIGHTS_ENABLE_DEPENDENCY_TRACKING: data.APPINSIGHTS_ENABLE_DEPENDENCY_TRACKING ?? true,
    APPINSIGHTS_ENABLE_AVAILABILITY_TRACKING: data.APPINSIGHTS_ENABLE_AVAILABILITY_TRACKING ?? true,
    APPINSIGHTS_TRACK_HEALTH_ENDPOINTS: data.APPINSIGHTS_TRACK_HEALTH_ENDPOINTS ?? false,
    APPINSIGHTS_REDACT_QUERY_VALUES: data.APPINSIGHTS_REDACT_QUERY_VALUES ?? true,
  };
}
