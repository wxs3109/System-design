#!/usr/bin/env node
// P0 link repair: fix `] (` spacing and resolve translated paths to real files.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const APPLY = process.argv.includes('--apply')

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.tools') continue
    const p = path.join(d, e.name)
    e.isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}

const ALL = walk(ROOT)
const MD = ALL.filter(f => f.endsWith('.md'))
const rel = f => path.relative(ROOT, f).split(path.sep).join('/')

// Index every real file/dir by a normalized token signature.
const norm = s =>
  s.toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Common translation drift: map translated words back to repo vocabulary.
const SYN = {
  impotent: 'idempotency', impotence: 'idempotency', idempotence: 'idempotency',
  universal: 'general', common: 'general', generic: 'general',
  concept: 'concepts', pattern: 'patterns', component: 'components',
  synchronization: 'synchronous', asynchronization: 'asynchronous',
  downgrade: 'degradation', degradation: 'degradation',
  governance: 'management',
  link: 'path', links: 'path', release: 'publishing', publishing: 'publishing',
  casedesign: 'case design', 'data storage': 'data and storage',
  fragment: 'shard', authoritative: 'source of truth',
  lifecycle: 'life cycle', portal: 'entry',
  interview: 'interview', method: 'method',
  latency: 'latency', throughput: 'throughput',
}

const canon = s =>
  norm(s).split(' ').map(w => SYN[w] ?? w).join(' ')

// Build lookup: canonical signature -> real path (files and dirs)
const index = new Map()
const addIdx = (p) => {
  const r = rel(p)
  const base = path.basename(r)
  for (const key of [canon(base), canon(r)]) {
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(r)
  }
}
for (const f of ALL) addIdx(f)
const dirs = new Set(ALL.map(f => path.dirname(f)))
for (const d of dirs) { if (d !== ROOT) addIdx(d) }

// token-overlap scoring fallback
const CANDIDATES = [...new Set([...ALL.map(rel), ...[...dirs].filter(d => d !== ROOT).map(rel)])]
const tokenize = s => new Set(canon(s).split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w)))

// Targets the token matcher can't reach: the translated name shares too few
// tokens with the real filename. Keyed by the raw broken target.
const OVERRIDES = {
  '01-When to become asynchronous.md':
    '01-when-to-asynchronously-determination-methods-and-counterexamples.md',
  '12-Real implementation of core concepts/':
    '12-navigation-from-core-concepts-to-production-product/',
  '12-Real Implementation of Core Concepts/':
    '12-navigation-from-core-concepts-to-production-product/',
  '../01-Data List Fact Boundary and Access Mode/':
    '../01-data-inventory-source-of-truth-and-access-pattern/',
  '../../04-Infrastructure Component/06-Task Queue and Publish and Subscribe/':
    '../../04-Infrastructure-Components/06-task-queues-and-pub-sub/',
  '03-Post distribution and reliability.md':
    '03-feeditem-backfill-cutover-and-reliability.md',
}

function resolveTarget(fromFile, rawTarget) {
  const [pathPart, hash] = rawTarget.split('#')
  const clean = pathPart.trim()
  if (!clean || /^(https?:|mailto:)/.test(clean)) return null

  const fromDir = path.dirname(fromFile)

  if (Object.hasOwn(OVERRIDES, clean)) {
    const t = OVERRIDES[clean]
    if (fs.existsSync(path.resolve(fromDir, t))) {
      return { fixed: hash ? `${t}#${hash}` : t }
    }
  }
  const direct = path.resolve(fromDir, decodeURIComponent(clean))
  if (fs.existsSync(direct)) return null // already valid

  // Score every real path against the broken target's tokens.
  const want = tokenize(clean)
  if (want.size === 0) return null

  // Prefer keeping the same depth intent (../ count) and the trailing segment.
  const lastSeg = clean.replace(/\/$/, '').split('/').pop()
  const wantLast = tokenize(lastSeg)

  let best = null, bestScore = 0
  for (const cand of CANDIDATES) {
    const have = tokenize(cand)
    let hit = 0
    for (const w of want) if (have.has(w)) hit++
    if (hit === 0) continue

    const candLast = tokenize(path.basename(cand))
    let lastHit = 0
    for (const w of wantLast) if (candLast.has(w)) lastHit++

    // Trailing segment must substantially match — this is the anchor.
    const lastRatio = wantLast.size ? lastHit / wantLast.size : 0
    if (lastRatio < 0.6) continue

    const score = hit / want.size + lastRatio * 2 - cand.split('/').length * 0.01
    if (score > bestScore) { bestScore = score; best = cand }
  }

  if (!best || bestScore < 1.4) return { unresolved: true, target: clean }

  let out = path.relative(fromDir, path.resolve(ROOT, best)).split(path.sep).join('/')
  if (!out.startsWith('.')) out = './' + out
  // preserve directory trailing slash for dir targets
  if (fs.existsSync(path.resolve(ROOT, best)) && fs.statSync(path.resolve(ROOT, best)).isDirectory()) {
    if (!out.endsWith('/')) out += '/'
  }
  return { fixed: hash ? `${out}#${hash}` : out }
}

let nSpace = 0, nPath = 0, nUnresolved = 0
const unresolved = []

for (const file of MD) {
  let text = fs.readFileSync(file, 'utf8')
  const orig = text

  // 1) collapse `] (` -> `](`  and 2) repair the target inside
  text = text.replace(/\[([^\]\n]*)\]\s+\(([^)\n]+)\)/g, (m, label, target) => {
    nSpace++
    const r = resolveTarget(file, target)
    if (r?.fixed) { nPath++; return `[${label}](${r.fixed})` }
    if (r?.unresolved) { nUnresolved++; unresolved.push([rel(file), target]) }
    return `[${label}](${target})`
  })

  // also repair already-tight links whose target is broken
  text = text.replace(/\[([^\]\n]*)\]\(([^)\n]+)\)/g, (m, label, target) => {
    const r = resolveTarget(file, target)
    if (r?.fixed) { nPath++; return `[${label}](${r.fixed})` }
    if (r?.unresolved && !unresolved.some(u => u[0] === rel(file) && u[1] === target)) {
      nUnresolved++; unresolved.push([rel(file), target])
    }
    return m
  })

  if (text !== orig && APPLY) fs.writeFileSync(file, text)
}

console.log(`[links] '] (' spacing fixed : ${nSpace}`)
console.log(`[links] paths re-resolved   : ${nPath}`)
console.log(`[links] still unresolved    : ${nUnresolved}`)
if (unresolved.length) {
  console.log('\n--- unresolved (need manual/target does not exist yet) ---')
  for (const [f, t] of unresolved) console.log(`  ${f}\n      -> ${t}`)
}
console.log(APPLY ? '\nAPPLIED' : '\nDRY RUN (pass --apply)')
