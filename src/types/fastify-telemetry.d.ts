import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    telemetry?: {
      traceId: string;
      spanId: string;
      parentSpanId?: string;
      startTimeMs: number;
      routeName?: string;
      properties?: Record<string, string>;
    };
  }
}
