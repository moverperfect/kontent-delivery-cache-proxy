import { createHash } from "node:crypto";

export function sha256Hex(input: string | Buffer): string {
  const h = createHash("sha256");
  if (typeof input === "string") {
    h.update(input, "utf8");
  } else {
    h.update(input);
  }
  return h.digest("hex");
}

export function hashTokenIdentity(raw: string | undefined): string | undefined {
  if (!raw || raw.length === 0) return undefined;
  return sha256Hex(raw).slice(0, 16);
}
