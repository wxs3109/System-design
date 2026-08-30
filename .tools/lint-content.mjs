#!/usr/bin/env node
// Content hygiene lint. Exits non-zero on regression.
//
// Guards the three P0 fixes:
//   1. relative links resolve to a real file or directory
//   2. `] (` spacing never comes back
//   3. banned vocabulary (see root README "Terminology convention")
//   4. `-Text` bullets missing their space
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.tools') continue
    const p = path.join(d, e.name)
    e.isDirectory() ? walk(p, out) : e.name.endsWith('.md') && out.push(p)
  }
  return out
}

// The root README quotes bad terms as counter-examples; that is the rule itself.
const PROTECTED = [
  ['README.md', /Don’t create your own abbreviations|Terms must carry objects and boundaries/],
]

const BANNED = [
  [/\bImpotent\b/i, 'Impotent/Impotence', 'Idempotent / Idempotency'],
  [/\bcurrent limiting\b/i, 'current limiting', 'Rate Limiting'],
  [/\bUniversal Design Pattern/i, 'Universal Design Pattern', 'General Design Patterns'],
  [/\bGeneric Design Pattern/i, 'Generic Design Pattern', 'General Design Patterns'],
  [/\bwater level/i, 'water level', '`Watermark`'],
  [/\bstream cutting\b/i, 'stream cutting', '`Traffic Cutover` / `Read Cutover` / `Write Cutover`'],
  [/\bread back to origin\b/i, 'read back to origin', '`Origin Fetch`'],
  [/\bKillings\b/, 'Killings', 'Bans / takedowns'],
]

// Working trees on Windows are commonly CRLF, so normalize before matching.
// Without this, every line carries a trailing \r and `(.*)$` swallows it,
// which silently breaks heading slugs and end-of-line patterns.
const readLines = (abs) => fs.readFileSync(abs, 'utf8').split(/\r?\n/)

const errors = []
const add = (file, line, kind, msg) => errors.push({ file, line, kind, msg })

// GitHub heading -> anchor: lowercase, drop punctuation, spaces to dashes.
const slugCache = new Map()
const headingSlugs = (abs) => {
  if (slugCache.has(abs)) return slugCache.get(abs)
  const set = new Set()
  for (const l of readLines(abs)) {
    const h = /^#{1,6}\s+(.*)$/.exec(l)
    if (!h) continue
    set.add(
      h[1].trim().toLowerCase()
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .replace(/ /g, '-')
    )
  }
  slugCache.set(abs, set)
  return set
}

for (const abs of walk(ROOT)) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  const dir = path.dirname(abs)
  const lines = readLines(abs)

  let inFence = false
  let inFrontMatter = false

  lines.forEach((line, i) => {
    const no = i + 1

    if (i === 0 && line.trim() === '---') { inFrontMatter = true; return }
    if (inFrontMatter) { if (line.trim() === '---') inFrontMatter = false; return }
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return }
    if (inFence) return

    const isProtected = PROTECTED.some(([f, p]) => rel === f && p.test(line))

    // 2) `] (` spacing
    if (/\]\s+\(/.test(line)) {
      add(rel, no, 'link-space', 'Markdown link has a space between ] and ( — will not render')
    }

    // 1) link targets resolve
    for (const m of line.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const raw = m[1].trim()
      if (/^(https?:|mailto:)/.test(raw)) continue
      const [target, anchor] = raw.split('#')
      if (!target) continue
      const resolved = path.resolve(dir, decodeURIComponent(target))
      if (!fs.existsSync(resolved)) {
        add(rel, no, 'dead-link', `target does not exist: ${target}`)
        continue
      }
      // A GitHub anchor is lowercase, spaceless and punctuation-stripped. A raw
      // heading pasted in as an anchor silently fails to jump, so check it.
      if (anchor && fs.statSync(resolved).isFile()) {
        if (/[A-Z ]/.test(anchor)) {
          add(rel, no, 'anchor', `anchor is not slugified: #${anchor}`)
        } else if (!headingSlugs(resolved).has(anchor)) {
          add(rel, no, 'anchor', `no such heading: #${anchor}`)
        }
      }
    }

    // 3) banned vocabulary
    if (!isProtected) {
      for (const [pat, bad, good] of BANNED) {
        if (pat.test(line)) add(rel, no, 'term', `"${bad}" -> use ${good}`)
      }
    }

    // 4) malformed bullets
    if (/^-[A-Za-z]/.test(line)) {
      add(rel, no, 'list', 'bullet missing space after "-"')
    }
  })
}

if (errors.length === 0) {
  console.log('content lint: clean')
  process.exit(0)
}

const byKind = new Map()
for (const e of errors) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1)

for (const e of errors) {
  console.log(`${e.file}:${e.line}  [${e.kind}] ${e.msg}`)
}
console.log(`\ncontent lint: ${errors.length} problem(s)`)
for (const [k, v] of byKind) console.log(`  ${k}: ${v}`)
process.exit(1)
