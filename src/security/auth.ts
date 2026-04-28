import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

export function verifyBearer(request: FastifyRequest, token: string): boolean {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const presented = auth.slice(7).trim();
  return presented === token && token.length > 0;
}

export function isInternalAuthorized(request: FastifyRequest, config: AppConfig): boolean {
  return verifyBearer(request, config.PURGE_TOKEN);
}
