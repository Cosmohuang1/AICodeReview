import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { BrowserConfig } from './config.js';
import { matchesGlob } from './config.js';
import { customFrameworkMappings } from './custom-framework.js';

const CODE = /\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/;
const SKIP = new Set(['.git', 'node_modules', '.next', '.nuxt', 'dist', 'build', 'coverage', '.ai-review', '.turbo']);
const MAX_FILES = 3000;
const MAX_BYTES = 512 * 1024;

function normalized(p: string): string { return p.split(path.sep).join('/'); }

function listCodeFiles(root: string): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  const stack = [root];
  let truncated = false;
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { truncated = true; break; }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) stack.push(absolute);
      } else if (entry.isFile() && CODE.test(entry.name)) {
        try {
          if (fs.statSync(absolute).size <= MAX_BYTES) files.push(normalized(path.relative(root, absolute)));
        } catch { /* unreadable */ }
      }
    }
    if (truncated) break;
  }
  return { files, truncated };
}

function compilerOptions(root: string): ts.CompilerOptions {
  const tsconfig = path.join(root, 'tsconfig.json');
  if (fs.existsSync(tsconfig)) {
    const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
      return { ...parsed.options, allowJs: true };
    }
  }
  return { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext };
}

function importsFor(root: string, file: string, options: ts.CompilerOptions): string[] {
  const absolute = path.join(root, file);
  let source: string;
  try { source = fs.readFileSync(absolute, 'utf8'); } catch { return []; }
  const node = ts.createSourceFile(
    absolute, source, ts.ScriptTarget.Latest, true,
    /\.tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx?$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );
  const imports = new Set<string>();
  const record = (specifier: string) => {
    if (!specifier || specifier.startsWith('node:')) return;
    const resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule?.resolvedFileName;
    if (!resolved) return;
    const relative = normalized(path.relative(root, path.resolve(resolved)));
    if (relative && !relative.startsWith('../') && relative !== '..' && !path.isAbsolute(relative)) {
      imports.add(relative);
    }
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
      if (n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) record(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.arguments.length === 1 &&
      ts.isStringLiteral(n.arguments[0])) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require')) {
        record(n.arguments[0].text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...imports];
}

function routeFromFile(file: string): string | null {
  const clean = file.replace(/\\/g, '/');
  let routePart: string | null = null;
  const app = clean.match(/^(?:src\/)?app\/(.*)page\.(?:tsx?|jsx?)$/);
  if (app) routePart = app[1].replace(/\/$/, '');
  const pages = clean.match(/^(?:src\/)?pages\/(.*)\.(?:tsx?|jsx?)$/);
  if (pages && !pages[1].startsWith('api/') &&
    !/^_(?:app|document|error)$/.test(pages[1])) routePart = pages[1].replace(/(?:^|\/)index$/, '');
  if (routePart === null) return null;
  const segments = routePart.split('/').filter(Boolean)
    .filter(s => !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('@'));
  // A dynamic route needs example params. Do not invent paths like /[id].
  if (segments.some(s => s.includes('[') || s.includes(']'))) return null;
  return '/' + segments.join('/');
}


type RouterScreen = { route: string; dependency?: string };

function reactRouterScreens(root: string, file: string, options: ts.CompilerOptions): RouterScreen[] {
  const absolute = path.join(root, file);
  let text: string;
  try { text = fs.readFileSync(absolute, 'utf8'); } catch { return []; }
  if (!/react-router(?:-dom)?/.test(text)) return [];
  const ast = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true,
    /\.tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Map<string, string>();
  for (const stmt of ast.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const resolved = ts.resolveModuleName(stmt.moduleSpecifier.text, absolute, options, ts.sys)
      .resolvedModule?.resolvedFileName;
    if (!resolved) continue;
    const dependency = normalized(path.relative(root, path.resolve(resolved)));
    if (dependency.startsWith('../') || path.isAbsolute(dependency)) continue;
    if (stmt.importClause?.name) imports.set(stmt.importClause.name.text, dependency);
    const named = stmt.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) imports.set(element.name.text, dependency);
    }
  }
  const result: RouterScreen[] = [];
  const nameOf = (value: ts.Expression): string | undefined => {
    if (ts.isIdentifier(value)) return value.text;
    if (ts.isJsxSelfClosingElement(value)) return value.tagName.getText(ast).split('.')[0];
    if (ts.isJsxElement(value)) return value.openingElement.tagName.getText(ast).split('.')[0];
    if (ts.isParenthesizedExpression(value)) return nameOf(value.expression);
    return undefined;
  };
  const push = (route: string, symbol?: string) => {
    if (!route.startsWith('/') || route.startsWith('//') ||
        /[:*?#[\]\\]/.test(route) || !symbol) return;
    result.push({ route, dependency: imports.get(symbol) });
  };
  const attribute = (jsx: ts.JsxOpeningLikeElement, key: string): ts.JsxAttribute | undefined =>
    jsx.attributes.properties.find((a): a is ts.JsxAttribute =>
      ts.isJsxAttribute(a) && a.name.getText(ast) === key);
  const extractObject = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      let route: string | undefined, symbol: string | undefined;
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = property.name.getText(ast).replace(/^['"]|['"]$/g, '');
        if (key === 'path' && ts.isStringLiteral(property.initializer)) route = property.initializer.text;
        if (key === 'element' || key === 'Component') symbol = nameOf(property.initializer);
      }
      if (route) push(route, symbol);
    }
    ts.forEachChild(node, extractObject);
  };
  const visit = (node: ts.Node) => {
    const jsx = ts.isJsxSelfClosingElement(node) ? node :
      ts.isJsxElement(node) ? node.openingElement : null;
    if (jsx && jsx.tagName.getText(ast).split('.').pop() === 'Route') {
      const p = attribute(jsx, 'path')?.initializer;
      const e = attribute(jsx, 'element')?.initializer;
      const component = attribute(jsx, 'Component')?.initializer;
      const expression = e && ts.isJsxExpression(e) ? e.expression :
        component && ts.isJsxExpression(component) ? component.expression : undefined;
      if (p && ts.isStringLiteral(p) && expression) push(p.text, nameOf(expression));
    }
    if (ts.isCallExpression(node) &&
      ['createBrowserRouter','createHashRouter','useRoutes'].includes(node.expression.getText(ast))) {
      for (const arg of node.arguments) extractObject(arg);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

export interface ImpactRoute {
  route: string;
  routeFile: string;
  via: string[];
  sourceFiles: string[];
  confidence: 'framework' | 'explicit';
}

export interface ImpactAnalysis {
  routes: ImpactRoute[];
  mappings: BrowserConfig['mappings'];
  scannedFiles: number;
  truncated: boolean;
  warnings: string[];
}

/**
 * Build a bounded reverse import graph, trace changed source files to routes,
 * then augment explicit mappings with their changed upstream dependencies.
 * No LLM inference or project scripts are executed.
 */
export function analyzeImpact(root: string, changedFiles: string[], config: BrowserConfig, maxDepth = 3): ImpactAnalysis {
  const workspace = path.resolve(root);
  const { files, truncated } = listCodeFiles(workspace);
  const indexed = new Set(files);
  const options = compilerOptions(workspace);
  const reverse = new Map<string, Set<string>>();
  const warnings: string[] = [];
  for (const file of files) {
    for (const dependency of importsFor(workspace, file, options)) {
      if (!indexed.has(dependency)) continue;
      const users = reverse.get(dependency) ?? new Set<string>();
      users.add(file);
      reverse.set(dependency, users);
    }
  }
  if (truncated) warnings.push('Import graph capped at ' + MAX_FILES + ' files; impact may be incomplete.');

  const owners = new Map<string, Set<string>>();
  const changed = [...new Set(changedFiles.map(f => f.replace(/\\/g, '/')))];
  for (const source of changed) {
    const frontier = [{ file: source, depth: 0 }];
    const visited = new Set<string>();
    while (frontier.length) {
      const { file, depth } = frontier.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const set = owners.get(file) ?? new Set<string>();
      set.add(source);
      owners.set(file, set);
      if (depth < maxDepth) {
        for (const parent of reverse.get(file) ?? []) frontier.push({ file: parent, depth: depth + 1 });
      }
    }
  }

  const custom = customFrameworkMappings(workspace, changed, config);
  warnings.push(...custom.warnings);
  const resultRoutes: ImpactRoute[] = [];
  const mappings: BrowserConfig['mappings'] = custom.mappings.map(mapping => {
    const related = new Set<string>();
    for (const [file, sources] of owners) {
      if (mapping.files.some(pattern => matchesGlob(file, pattern))) {
        for (const src of sources) related.add(src);
        resultRoutes.push({
          route: mapping.route, routeFile: file, via: [file],
          sourceFiles: [...sources], confidence: 'explicit'
        });
      }
    }
    for (const source of changed) {
      if (mapping.files.some(pattern => matchesGlob(source, pattern))) {
        related.add(source);
        if (!resultRoutes.some(r => r.route === mapping.route)) resultRoutes.push({
          route: mapping.route, routeFile: '(company framework mapping)', via: mapping.files,
          sourceFiles: [source], confidence: 'explicit'
        });
      }
    }
    return { ...mapping, files: [...new Set([...mapping.files, ...related])] };
  });

  const explicitlyMappedRoutes = new Set(resultRoutes.map(route => route.route));
  const discovered = new Map<string, ImpactRoute>();
  for (const [file, sources] of owners) {
    const route = routeFromFile(file);
    if (!route) continue;
    if (explicitlyMappedRoutes.has(route)) continue;
    const item = discovered.get(route);
    if (item) {
      item.sourceFiles = [...new Set([...item.sourceFiles, ...sources])];
      item.via.push(file);
    } else {
      discovered.set(route, {
        route, routeFile: file, via: [file],
        sourceFiles: [...sources], confidence: 'framework'
      });
    }
  }
  for (const file of files) {
    for (const screen of reactRouterScreens(workspace, file, options)) {
      if (explicitlyMappedRoutes.has(screen.route)) continue;
      const related = new Set<string>();
      if (changed.includes(file)) for (const src of owners.get(file) ?? []) related.add(src);
      if (screen.dependency) for (const src of owners.get(screen.dependency) ?? []) related.add(src);
      if (!related.size) continue;
      const item = discovered.get(screen.route);
      const via = [file, ...(screen.dependency ? [screen.dependency] : [])];
      if (item) {
        item.sourceFiles = [...new Set([...item.sourceFiles, ...related])];
        item.via = [...new Set([...item.via, ...via])];
      } else {
        discovered.set(screen.route, {
          route: screen.route, routeFile: file, sourceFiles: [...related],
          via, confidence: 'framework'
        });
      }
    }
  }
  for (const route of discovered.values()) {
    resultRoutes.push(route);
    mappings.push({ files: route.sourceFiles, route: route.route });
  }
  const deduped = new Map<string, ImpactRoute>();
  for (const route of resultRoutes) {
    const existing = deduped.get(route.route);
    if (existing) {
      existing.sourceFiles = [...new Set([...existing.sourceFiles, ...route.sourceFiles])];
      existing.via = [...new Set([...existing.via, ...route.via])];
    } else deduped.set(route.route, route);
  }
  if (!resultRoutes.length) warnings.push('No impacted route identified; configure browser.mappings and browser.dependencyRules for the company framework.');
  return {
    routes: [...deduped.values()], mappings, scannedFiles: files.length,
    truncated, warnings
  };
}
