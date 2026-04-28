import type { DependencyExtractionContext } from "./queryDependencyExtractor.js";
import { deriveSyntheticQueryDeps } from "./queryDependencyExtractor.js";

interface SystemLike {
  codename?: string;
  type?: string;
}

interface KontentItemLike {
  system?: SystemLike;
  elements?: Record<string, unknown>;
}

function addTaxonomyDeps(item: KontentItemLike, deps: Set<string>): void {
  const els = item.elements;
  if (!els || typeof els !== "object") return;
  for (const [, value] of Object.entries(els)) {
    if (!value || typeof value !== "object") continue;
    const el = value as Record<string, unknown>;
    const taxonomyGroup = el.taxonomy_group ?? el.taxonomyGroup;
    if (typeof taxonomyGroup !== "object" || taxonomyGroup === null) continue;
    const tg = taxonomyGroup as Record<string, unknown>;
    const name = tg.name;
    const terms = tg.terms ?? tg.taxonomy_terms;
    if (!Array.isArray(terms)) continue;
    const groupId =
      typeof name === "string"
        ? name
        : typeof tg.codename === "string"
          ? tg.codename
          : "unknown";
    for (const term of terms) {
      if (typeof term === "object" && term !== null && "codename" in term) {
        const cn = (term as { codename?: string }).codename;
        if (typeof cn === "string") {
          deps.add(`taxonomy:${groupId}:${cn}`);
        }
      }
    }
  }
}

function walkItems(root: unknown, deps: Set<string>): void {
  const items = extractItems(root);
  for (const item of items) {
    const sys = item.system;
    if (sys?.codename) deps.add(`item:${sys.codename}`);
    if (sys?.type) deps.add(`type:${sys.type}`);
    addTaxonomyDeps(item, deps);
  }

  const modular = extractModular(root);
  for (const item of modular) {
    const sys = item.system;
    if (sys?.codename) deps.add(`item:${sys.codename}`);
    if (sys?.type) deps.add(`type:${sys.type}`);
    addTaxonomyDeps(item, deps);
  }
}

function extractItems(root: unknown): KontentItemLike[] {
  if (!root || typeof root !== "object") return [];
  const o = root as Record<string, unknown>;
  const items = o.items;
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is KontentItemLike => typeof x === "object" && x !== null);
}

function extractModular(root: unknown): KontentItemLike[] {
  if (!root || typeof root !== "object") return [];
  const o = root as Record<string, unknown>;
  const mc = o.modular_content;
  if (!mc || typeof mc !== "object" || mc === null) return [];
  const out: KontentItemLike[] = [];
  for (const v of Object.values(mc as Record<string, unknown>)) {
    if (typeof v === "object" && v !== null) {
      out.push(v as KontentItemLike);
    }
  }
  return out;
}

export function extractDependencyKeys(
  responseBody: unknown,
  context: DependencyExtractionContext,
): string[] {
  const deps = new Set<string>();

  deps.add(`environment:${context.environmentId}`);

  const lang =
    context.query.get("language") ??
    context.query.get("culture") ??
    context.language;
  if (lang) {
    deps.add(`language:${lang}`);
  }

  for (const s of deriveSyntheticQueryDeps(context)) {
    deps.add(s);
  }

  try {
    walkItems(responseBody, deps);
  } catch {
    /* malformed JSON already filtered */
  }

  return [...deps].sort();
}
