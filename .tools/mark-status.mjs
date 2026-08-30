// Sync a derived "State" column in the case-map tables of the three group
// READMEs. Markers come from .tools/case-status.mjs so they track the tree
// instead of drifting the way hand-maintained status columns do.
//
// Idempotent and re-syncing: rows that already carry a marker are updated in
// place, so this is the command to run after a case gains or loses content.
import fs from 'node:fs'
import path from 'node:path'
import { classify } from './case-status.mjs'

const ROOT = process.cwd()
const APPLY = process.argv.includes('--apply')

const MARK = { done: '✅', partial: '🚧', skeleton: '📋' }
const MARKS = Object.values(MARK).join('')

const GROUP_README = {
  '06-case-design/01-common-basic-system': '06-case-design/01-common-basic-system/README.md',
  '06-case-design/02-specific-application-system': '06-case-design/02-specific-application-system/README.md',
  '06-case-design/03-platform-system': '06-case-design/03-platform-system/README.md',
}

const tiers = new Map()
for (const r of classify()) tiers.set(`${r.group}/${r.name}`, r.tier)

let added = 0, updated = 0, unchanged = 0

for (const [group, readme] of Object.entries(GROUP_README)) {
  const abs = path.join(ROOT, readme)
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/)

  let inCaseMap = false
  let headerSeen = false
  let headerGainedColumn = false

  const out = lines.map(line => {
    // The three groups do not share one wording for the case-list heading.
    if (/^##\s+(?:Case\s*Map|Current\s+case)/i.test(line)) {
      inCaseMap = true; headerSeen = false; return line
    }
    if (inCaseMap && /^##\s/.test(line)) { inCaseMap = false; return line }
    if (!inCaseMap || !line.startsWith('|')) return line

    // Header row, with or without a State column already present.
    if (!headerSeen && /^\|\s*(?:State\s*\|\s*)?(?:Case|Classification)\s*\|/i.test(line)) {
      headerSeen = true
      if (/^\|\s*State\s*\|/i.test(line)) { unchanged++; return line }
      added++
      headerGainedColumn = true
      return line.replace(/^\|/, '| State |')
    }

    // Separator row: widen only when the header just gained a column, so a
    // re-run does not keep prepending cells.
    if (headerSeen && /^\|[\s:|-]+\|$/.test(line)) {
      if (!headerGainedColumn) return line
      headerGainedColumn = false
      return line.replace(/^\|/, '|---|')
    }

    // Body row, with or without an existing marker.
    //
    // The `u` flag is required: 🚧 and 📋 are surrogate pairs, so a character
    // class without it only ever matches the BMP marker (✅) and silently
    // skips the rest — which would make re-sync a no-op for those rows.
    const m = new RegExp(`^\\|\\s*(?:[${MARKS}]\\s*\\|\\s*)?\\[[^\\]]*\\]\\(([^)]+)\\)`, 'u').exec(line)
    if (!m) return line
    const dir = m[1].replace(/\/$/, '').replace(/^\.\//, '')
    const tier = tiers.get(`${group}/${dir}`)
    if (!tier) return line

    const has = new RegExp(`^\\|\\s*([${MARKS}])\\s*\\|`, 'u').exec(line)
    if (has) {
      if (has[1] === MARK[tier]) { unchanged++; return line }
      updated++
      return line.replace(new RegExp(`^\\|\\s*[${MARKS}]\\s*\\|`, 'u'), `| ${MARK[tier]} |`)
    }
    added++
    return line.replace(/^\|/, `| ${MARK[tier]} |`)
  })

  const text = out.join('\n')
  if (APPLY && text !== lines.join('\n')) fs.writeFileSync(abs, text)
}

console.log(`added: ${added}   updated: ${updated}   already correct: ${unchanged}`)
console.log(APPLY ? 'APPLIED' : 'DRY RUN (pass --apply)')
