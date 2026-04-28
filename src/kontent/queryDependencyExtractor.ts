import { normaliseUpstreamPath } from "../utils/canonicalUrl.js";

export interface DependencyExtractionContext {
  environmentId: string;
  mode: "delivery" | "preview";
  path: string;
  query: URLSearchParams;
  language?: string;
}

/** Synthetic deps from HTTP path/query (not JSON body). */
export function deriveSyntheticQueryDeps(context: DependencyExtractionContext): string[] {
  const deps: string[] = [];
  const normPath = normaliseUpstreamPath(context.path);
  deps.push(`query:path:${normPath}`);

  const lang =
    context.query.get("language") ??
    context.query.get("culture") ??
    context.language ??
    undefined;
  if (lang) {
    deps.push(`language:${lang}`);
  }

  const codename =
    context.query.get("system.codename") ??
    context.query.get("codename") ??
    context.query.get("elements.codename") ??
    undefined;
  if (codename) {
    deps.push(`query:items:codename:${codename}`);
  }

  const itemType =
    context.query.get("system.type") ?? context.query.get("type") ?? undefined;
  if (itemType) {
    deps.push(`query:items:type:${itemType}`);
  }

  const collection =
    context.query.get("collection") ??
    context.query.get("system.collection") ??
    undefined;
  if (collection) {
    deps.push(`query:items:collection:${collection}`);
  }

  const taxonomyPair = extractTaxonomyQuery(context.query);
  if (taxonomyPair) {
    deps.push(`query:items:taxonomy:${taxonomyPair.group}:${taxonomyPair.term}`);
  }

  return deps;
}

function extractTaxonomyQuery(query: URLSearchParams): { group: string; term: string } | undefined {
  for (const [key, value] of query.entries()) {
    const m = /^elements\.([^[\]]+)\[(\d+)\]\.taxonomy\.(.+)$/.exec(key);
    if (m) {
      return { group: m[3], term: value };
    }
    const simple = /^taxonomy\.([^[\]]+)\[(\d+)\]\.(.+)$/.exec(key);
    if (simple) {
      return { group: simple[3], term: value };
    }
  }
  const legacy = query.get("taxonomy_group") ?? query.get("taxonomyGroup");
  const term = query.get("taxonomy_term") ?? query.get("taxonomyTerm");
  if (legacy && term) {
    return { group: legacy, term };
  }
  return undefined;
}
