export function isoNow(): string {
  return new Date().toISOString();
}

export function addSeconds(isoOrDate: string | Date, seconds: number): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return new Date(d.getTime() + seconds * 1000).toISOString();
}
