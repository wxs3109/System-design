#!/usr/bin/env node
// P0 terminology normalization. Enforces the vocabulary declared in the root
// README "Terminology convention" section.
//
// The root README itself quotes the bad terms as counter-examples ("don't write
// 'water level', write `Watermark`"). Those lines are protected — rewriting them
// would destroy the rule that motivates this script.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const APPLY = process.argv.includes('--apply')

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.tools') continue
    const p = path.join(d, e.name)
    e.isDirectory() ? walk(p, out) : e.name.endsWith('.md') && out.push(p)
  }
  return out
}

// [pattern, replacement] — case-preserving handled by explicit variants.
const RULES = [
  // Idempotency: "Impotent"/"Impotence" is a mistranslation with an unrelated meaning.
  [/\bImpotent\b/g, 'Idempotent'],
  [/\bimpotent\b/g, 'idempotent'],
  [/\bImpotence\b/g, 'Idempotency'],
  [/\bimpotence\b/g, 'idempotency'],

  // Rate Limiting is the term the README declares.
  [/\bCurrent limiting\b/g, 'Rate Limiting'],
  [/\bcurrent limiting\b/g, 'Rate Limiting'],
  [/\bCurrent-limiting\b/g, 'Rate-Limiting'],
  [/\bcurrent-limiting\b/g, 'rate-limiting'],

  // Chapter 05 is "General Design Patterns".
  [/\bUniversal Design Patterns\b/g, 'General Design Patterns'],
  [/\bUniversal Design Pattern\b/g, 'General Design Patterns'],
  [/\bUniversal design pattern\b/g, 'General Design Patterns'],
  [/\bGeneric Design Patterns\b/g, 'General Design Patterns'],
  [/\bCommon Design Patterns\b/g, 'General Design Patterns'],

  // README: use `Watermark`, `Origin Fetch`, `Traffic Cutover`.
  [/\bwater level\b/g, 'Watermark'],
  [/\bwater levels\b/g, 'Watermarks'],
  [/\bread back to origin\b/g, 'Origin Fetch'],

  // "Killings" is a mistranslation of ban/takedown.
  [/\bKillings, downgrades and appeal paths\b/g, 'Bans, takedowns and appeal paths'],
]

// Lines in these files matching these patterns are counter-example prose.
const PROTECT = [
  [/README\.md$/, /Don’t create your own abbreviations|Terms must carry objects and boundaries/],
]

let total = 0
const perRule = new Map()
const touched = new Set()

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const orig = fs.readFileSync(file, 'utf8')
  const lines = orig.split('\n')

  const out = lines.map(line => {
    const isProtected = PROTECT.some(
      ([fp, lp]) => fp.test(rel) && lp.test(line)
    )
    if (isProtected) return line

    let next = line
    for (const [pat, rep] of RULES) {
      const before = next
      next = next.replace(pat, rep)
      if (next !== before) {
        const n = (before.match(pat) || []).length
        perRule.set(pat.source, (perRule.get(pat.source) ?? 0) + n)
        total += n
        touched.add(rel)
      }
    }
    return next
  })

  const text = out.join('\n')
  if (text !== orig && APPLY) fs.writeFileSync(file, text)
}

for (const [k, v] of [...perRule.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(3)}  ${k}`)
}
console.log(`\n[terms] replacements: ${total} across ${touched.size} files`)
console.log(APPLY ? 'APPLIED' : 'DRY RUN (pass --apply)')
