import { randomBytes } from "node:crypto";

export function newRequestId(): string {
  return randomBytes(8).toString("hex");
}
