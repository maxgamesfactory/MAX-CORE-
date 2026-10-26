import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '..');
const layers = ['contracts', 'state', 'events', 'simulation', 'runtime', 'storage', 'intelligence', 'adapters'];
const allowed = {
  contracts: ['contracts'], state: ['contracts', 'state'], events: ['contracts', 'events', 'state'],
  simulation: ['contracts', 'simulation', 'state'], runtime: ['contracts', 'runtime', 'state'],
  storage: ['contracts', 'storage', 'state'], intelligence: ['contracts', 'intelligence'],
  adapters: layers, entry: layers
};
const errors = [];
async function inspect(directory, layer) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await inspect(path, layer); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    await inspectFile(path, layer);
  }
}
async function inspectFile(path, layer) {
    const file = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      if (layer === 'contracts') {
        const valid = ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
          || (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly)
          || (ts.isExportDeclaration(statement) && statement.isTypeOnly);
        if (!valid) errors.push(`${relative(root, path)}: contracts must contain only types`);
      }
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const dependency = relative(root, resolve(dirname(path), specifier)).split('/')[0];
        if (!specifier.startsWith('.') || !allowed[layer].includes(dependency)) errors.push(`${relative(root, path)}: forbidden dependency ${specifier}`);
        if (dependency === 'state' && layer !== 'state' && layer !== 'entry' && !specifier.endsWith('/state/json.js')) errors.push(`${relative(root, path)}: only JSON utilities may be shared from state`);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(file) === 'require')) errors.push(`${relative(root, path)}: dynamic dependencies are forbidden`);
      ts.forEachChild(node, visit);
    }
    visit(file);
}
for (const layer of layers) await inspect(resolve(root, layer), layer);
await inspectFile(resolve(root, 'index.ts'), 'entry');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.peerDependencies ?? {}).length || Object.keys(pkg.optionalDependencies ?? {}).length) errors.push('Core must have zero runtime, optional, and peer dependencies');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Architecture passed: type-only contracts, allowed layers, zero runtime dependencies.');
