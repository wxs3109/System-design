// Classify each case by what is actually on disk, so completion markers in the
// READMEs are derived rather than hand-maintained (and hand-drifted).
//
// Tiers:
//   done     - a full reading path exists (mainline + review, or a multi-part tree)
//   partial  - real design content, but not the full path
//   skeleton - a README stub only
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const GROUPS = [
  '06-case-design/01-common-basic-system',
  '06-case-design/02-specific-application-system',
  '06-case-design/03-platform-system',
]

const mdFiles = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) mdFiles(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

const lineCount = f => fs.readFileSync(f, 'utf8').split(/\r?\n/).length

export function classify() {
  const rows = []
  for (const g of GROUPS) {
    const base = path.join(ROOT, g)
    if (!fs.existsSync(base)) continue
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const dir = path.join(base, e.name)
      const files = mdFiles(dir)
      const lines = files.reduce((n, f) => n + lineCount(f), 0)
      const names = files.map(f => path.basename(f))

      const hasMainline = names.some(n => /mainline|main-line/i.test(n))
      const hasReview = names.some(n => /review-and-practice/i.test(n))
      // A multi-part case (news-feed, multi-tenant) organizes by subdirectories.
      const subDirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== 'assets').length

      let tier
      if ((hasMainline && hasReview) || subDirs >= 2) tier = 'done'
      else if (files.length > 1 || lines > 120) tier = 'partial'
      else tier = 'skeleton'

      rows.push({ group: g, name: e.name, files: files.length, lines, tier })
    }
  }
  return rows
}

import { pathToFileURL } from 'node:url'

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = classify()
  let g = ''
  for (const r of rows) {
    if (r.group !== g) { g = r.group; console.log(`\n### ${g}`) }
    console.log(`  ${r.tier.padEnd(9)} ${r.name.padEnd(38)} files=${String(r.files).padEnd(4)} lines=${r.lines}`)
  }
  const t = {}
  for (const r of rows) t[r.tier] = (t[r.tier] ?? 0) + 1
  console.log('\ntotals:', t)
}
