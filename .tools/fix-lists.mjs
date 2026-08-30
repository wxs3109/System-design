#!/usr/bin/env node
// P0 list-item repair: `-Text` -> `- Text`.
//
// Deliberately narrow. Only `-` followed immediately by a letter is treated as a
// broken bullet. `->` is arrow notation used for state transitions and flow
// sketches throughout the notes, and must survive untouched. Fenced code blocks
// and YAML front matter are skipped entirely.
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

let total = 0
const touched = []

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const orig = fs.readFileSync(file, 'utf8')
  const lines = orig.split('\n')

  let inFence = false
  let inFrontMatter = false
  let n = 0

  const out = lines.map((line, i) => {
    if (i === 0 && line.trim() === '---') { inFrontMatter = true; return line }
    if (inFrontMatter) {
      if (line.trim() === '---') inFrontMatter = false
      return line
    }
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line }
    if (inFence) return line

    // `-` + letter only. Not `->`, not `--`, not `- `.
    if (/^-[A-Za-z]/.test(line)) {
      n++
      return '- ' + line.slice(1)
    }
    return line
  })

  if (n > 0) {
    total += n
    touched.push([rel, n])
    if (APPLY) fs.writeFileSync(file, out.join('\n'))
  }
}

for (const [f, n] of touched) console.log(`  ${String(n).padStart(2)}  ${f}`)
console.log(`\n[lists] fixed: ${total} across ${touched.length} files`)
console.log(APPLY ? 'APPLIED' : 'DRY RUN (pass --apply)')
