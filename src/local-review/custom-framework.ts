import fs from 'node:fs';
import path from 'node:path';
import type { BrowserConfig } from './config.js';
import { matchesGlob } from './config.js';

const FILE = /\.(?:cs|js|mjs|cjs|html|htm|ts|tsx|jsx)$/i;
const OMIT = new Set(['node_modules','.git','bin','obj','dist','build','coverage','.ai-review','.next','.vs','TestResults']);
const MAX_FILES = 4000;
const MAX_BYTES = 256 * 1024;

function normalize(value: string): string { return value.replace(/\\/g, '/'); }

/** Framework-independent graph: only explicit rules and literal HTML script references. */
export function collectCustomFrameworkEdges(root: string, config: BrowserConfig): {
  edges: Map<string, Set<string>>;
  files: string[];
  warnings: string[];
} {
  const edges = new Map<string, Set<string>>();
  const files: string[] = [];
  const warnings: string[] = [];
  const directories = [root];
  while (directories.length && files.length < MAX_FILES) {
    const directory = directories.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!OMIT.has(entry.name) && !entry.name.startsWith('.')) directories.push(absolute);
      } else if (entry.isFile() && FILE.test(entry.name)) {
        try {
          if (fs.statSync(absolute).size <= MAX_BYTES) files.push(normalize(path.relative(root, absolute)));
        } catch { /* skip unreadable */ }
      }
      if (files.length >= MAX_FILES) break;
    }
  }
  if (directories.length || files.length >= MAX_FILES) warnings.push('Custom framework index capped; mapping may be incomplete.');

  const indexed = new Set(files);
  const add = (dependency: string, consumer: string) => {
    if (dependency === consumer || !indexed.has(consumer)) return;
    const set = edges.get(dependency) ?? new Set<string>();
    set.add(consumer);
    edges.set(dependency, set);
  };
  const lookupScript = (htmlFile: string, reference: string): string | null => {
    const raw = reference.trim();
    if (!raw || raw.startsWith('//') || /^[a-z][\w+.-]*:/i.test(raw)) return null;
    const ref = raw.split(/[?#]/)[0];
    if (!ref || !/\.m?js$/i.test(ref) || ref.includes('\\')) return null;
    const candidates = ref.startsWith('/')
      ? [ref.slice(1), 'wwwroot/' + ref.slice(1), 'public/' + ref.slice(1)]
      : [path.posix.normalize(path.posix.join(path.posix.dirname(htmlFile), ref))];
    for (const candidate of candidates) {
      if (candidate.startsWith('../') || candidate === '..') continue;
      if (indexed.has(candidate)) return candidate;
    }
    return null;
  };
  for (const html of files.filter(f => /\.html?$/i.test(f))) {
    let source = '';
    try { source = fs.readFileSync(path.join(root, html), 'utf8'); } catch { continue; }
    for (const tag of source.matchAll(/<script\b[^>]*>/gi)) {
      const src = tag[0].match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      if (!src) continue;
      const script = lookupScript(html, src[1] ?? src[2]);
      if (script) add(script, html);
    }
  }
  // The self-developed framework defines its own C# <-> UI relationship.
  // These links must be supplied explicitly rather than guessing from class names.
  for (const rule of config.dependencyRules) {
    const dependencies = files.filter(f => rule.dependencies.some(g => matchesGlob(f, g)));
    const consumers = files.filter(f => rule.consumers.some(g => matchesGlob(f, g)));
    if (!dependencies.length || !consumers.length) {
      warnings.push('Unmatched dependency rule: ' + rule.dependencies.join(', ') + ' -> ' + rule.consumers.join(', '));
    }
    for (const dependency of dependencies) {
      for (const consumer of consumers) add(dependency, consumer);
    }
  }
  return { edges, files, warnings };
}

/** For internal frameworks, pages are discovered only from an explicit mapping. */
export function customFrameworkMappings(root: string, changedFiles: string[], config: BrowserConfig): {
  mappings: BrowserConfig['mappings'];
  warnings: string[];
} {
  const indexed = collectCustomFrameworkEdges(root, config);
  const dependencies = new Map<string, Set<string>>();
  for (const source of changedFiles) {
    const start = normalize(source);
    const frontier = [start];
    const visited = new Set<string>();
    while (frontier.length) {
      const file = frontier.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const owners = dependencies.get(file) ?? new Set<string>();
      owners.add(start);
      dependencies.set(file, owners);
      if (visited.size > 300) {
        indexed.warnings.push('Dependency reachability capped for ' + start);
        break;
      }
      for (const parent of indexed.edges.get(file) ?? []) frontier.push(parent);
    }
  }
  return {
    mappings: config.mappings.map(mapping => {
      const additional = new Set<string>();
      for (const [file, sources] of dependencies) {
        if (mapping.files.some(glob => matchesGlob(file, glob))) {
          for (const source of sources) additional.add(source);
        }
      }
      return { ...mapping, files: [...new Set([...mapping.files, ...additional])] };
    }),
    warnings: indexed.warnings
  };
}
