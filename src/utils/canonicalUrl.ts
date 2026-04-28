/** Normalised upstream path starting with `/` (e.g. `/items`). */
export function normaliseUpstreamPath(pathFromEnv: string): string {
  let p = pathFromEnv.startsWith("/") ? pathFromEnv : `/${pathFromEnv}`;
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p || "/";
}

/** Sorted query string: keys sorted, duplicates preserved in stable order within key. */
export function canonicalQueryString(searchParams: URLSearchParams): string {
  const entries: [string, string][] = [];
  for (const [k, v] of searchParams.entries()) {
    entries.push([k, v]);
  }
  entries.sort((a, b) => {
    const ka = a[0];
    const kb = b[0];
    if (ka !== kb) return ka.localeCompare(kb);
    return a[1].localeCompare(b[1]);
  });
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}
