import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const ts = require('../apps/web/node_modules/typescript')
const root = process.cwd()
const errors = []
const app = 'apps/web/src/'
if (process.argv.includes('--self-test')) {
  const probes = [
    { file: app + 'core/__probe.ts', source: "import { useState } from 'react'", expected: 'core cannot depend' },
    { file: app + 'components/experiments/__probe.ts', source: "import { newsFeedDesign } from '../../features/design/news-feed'", expected: 'shared experiment UI' },
    { file: app + 'features/design/models/__probe.ts', source: "import { LabRepository } from '../../../core/experiments/repository'", expected: 'models may depend only' },
    { file: app + 'features/design/presentation/__probe.ts', source: "import { runMaps } from '../models/maps'", expected: 'presentation may use model types' },
    { file: app + 'features/design/__probe.tsx', source: "'use client'; import { experiments } from '../../experiments/registry'", expected: 'client imports the complete' },
    { file: 'packages/model/src/__probe.ts', source: "import { newsFeedDesign } from '../../../apps/web/src/features/design/news-feed'", expected: 'packages cannot depend' },
    { file: app + 'features/design/models/__probe.ts', source: "import { same } from '../../../core/experiments/equality'", expected: null },
  ]
  for (const probe of probes) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture', JSON.stringify(probe)], { cwd: root, encoding: 'utf8' })
    if (probe.expected ? run.status === 0 || !run.stderr.includes(probe.expected) : run.status !== 0) throw new Error(`Architecture guard failed its ${probe.file} probe: ${run.stderr}`)
  }
  process.stdout.write(`architecture guard self-tests: ${probes.length} passed\n`)
}
const fixtureIndex = process.argv.indexOf('--fixture')
const fixture = fixtureIndex < 0 ? null : JSON.parse(process.argv[fixtureIndex + 1])
if (fixture && (!/^(apps\/web\/src|packages)\//.test(fixture.file) || fixture.file.includes('..'))) throw new Error('Invalid architecture fixture path')
const normalize = file => file.replaceAll('\\', '/')
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.next', 'test-results'].includes(entry.name)) return []
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? files(file) : /\.(ts|tsx|mts)$/.test(file) ? [file] : []
  })
}
function target(file, specifier) {
  const resolved = specifier.startsWith('@/') ? app + specifier.slice(2) : specifier.startsWith('.') ? normalize(path.relative(root, path.resolve(path.dirname(file), specifier))) : specifier
  if (fs.existsSync(path.join(root, resolved, 'index.ts'))) return resolved + '/index'
  if (fs.existsSync(path.join(root, resolved, 'index.tsx'))) return resolved + '/index'
  return resolved
}
const eager = new Map(); const clients = []
const sourceFiles = [...files(path.join(root, 'apps/web/src')), ...files(path.join(root, 'packages'))]
if (fixture && !sourceFiles.includes(path.join(root, fixture.file))) sourceFiles.push(path.join(root, fixture.file))
for (const file of sourceFiles) {
  const relative = normalize(path.relative(root, file))
  if (/\.(test|typecheck)\./.test(relative)) continue
  const source = relative === fixture?.file ? fixture.source : fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const imports = []
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push({ spec: node.moduleSpecifier.text, typeOnly: ts.isImportDeclaration(node) ? !!node.importClause?.isTypeOnly : node.isTypeOnly, lazy: false })
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) imports.push({ spec: node.arguments[0].text, typeOnly: false, lazy: true })
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const code = relative.replace(/\.(ts|tsx|mts)$/, '')
  eager.set(code, imports.filter(i => !i.typeOnly).map(i => target(file, i.spec).replace(/\.(ts|tsx|mts)$/, '')))
  if (ast.statements.some(s => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === 'use client')) clients.push(code)
  const legacy = relative.includes('/compat/v1/')
  const model = !legacy && (/\/features\/practice\/[^/]+\/model\.ts$/.test(relative) || relative.includes('/features/design/models/') || /\/features\/design\/(geography|object-replicas)\.ts$/.test(relative))
  for (const item of imports) {
    const to = target(file, item.spec)
    const fail = message => errors.push(`${relative}: ${message} (${item.spec})`)
    if (relative.startsWith(app + 'core/') && (/^react(?:\/|$)|^next(?:\/|$)/.test(to) || to.startsWith(app) && !to.startsWith(app + 'core/'))) fail('experiment core cannot depend on application features or React')
    if (relative.startsWith(app + 'components/experiments/') && (to.startsWith(app + 'features/') || to.startsWith(app + 'experiments/'))) fail('shared experiment UI cannot depend on a concrete lesson or the application registry')
    if (model && (/^react(?:\/|$)|^next(?:\/|$)|^dexie$|^zustand/.test(to) || /\.(css|scss)$|\/(components|presentation)\/|\/lib\/|\/core\/experiments\/(repository|session|protocol-lesson)|\/(lesson|catalog)$|\.tsx$/.test(to))) fail('models may depend only on pure model contracts and helpers')
    if (relative.includes('/presentation/') && to.includes('/models/') && !item.typeOnly) fail('presentation may use model types, but must not execute models')
    if (relative.startsWith('packages/') && (to.startsWith(app) || item.spec.startsWith('@/'))) fail('workspace packages cannot depend on the web application')
  }
}
for (const client of clients) {
  const stack = [client]; const seen = new Set()
  while (stack.length) {
    const current = stack.pop(); if (seen.has(current)) continue; seen.add(current)
    if (current === app + 'experiments/registry') { errors.push(`${client}: client imports the complete application registry; use a leaf entry renderer`); break }
    stack.push(...(eager.get(current) ?? []))
  }
}
const page = fs.readFileSync(path.join(root, app, 'app/practice/[exerciseId]/page.tsx'), 'utf8')
if (/exerciseId\s*===|entry\.id\s*===|entry\.kind\s*===/.test(page)) errors.push('practice route must dispatch through the registry, not lesson-specific branches')
const legacyDir = path.join(root, app, 'features/design/compat/v1')
const manifest = JSON.parse(fs.readFileSync(path.join(legacyDir, 'manifest.json'), 'utf8'))
for (const [file, expected] of Object.entries(manifest.files)) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(legacyDir, file), 'utf8').replaceAll('\r\n', '\n')).digest('hex')
  if (hash !== expected) errors.push(`Frozen compatibility source changed: ${file}; introduce a new codec/version instead`)
}
if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1 }
else process.stdout.write('architecture boundaries: clean\n')
