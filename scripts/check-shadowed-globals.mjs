#!/usr/bin/env node
// Catches the bug that made the whole Dashboard read zero for four rounds of fixes.
//
// lucide-react exports icons whose names collide with JavaScript globals — Map, Image,
// Text, Table, History and friends.  Importing one plainly shadows the global for that
// entire module, and because a lucide icon is a forwardRef OBJECT rather than a function,
// `new Map()` in that file throws "Map is not a constructor".  Minified, that reads
// "co is not a constructor", which points at nothing.
//
// The fix is always to alias the icon: `import { Map as MapIcon } from 'lucide-react'`.
//
// Run: npm run check:globals

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const GLOBALS = [
  'Map', 'Set', 'Image', 'Text', 'Table', 'Option', 'History', 'Comment',
  'Navigation', 'Range', 'Notification', 'Screen', 'Command', 'Frame',
  'Audio', 'Worker', 'Event',
]

const files = execSync(`find src -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \\)`)
  .toString().trim().split('\n').filter(Boolean)

const problems = []

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/s)
  if (!importMatch) continue

  // Names bound without an alias — those are the ones that shadow.
  const bound = importMatch[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !s.includes(' as '))

  for (const g of GLOBALS) {
    if (!bound.includes(g)) continue
    const re = new RegExp(`\\bnew\\s+${g}\\s*[<(]`)
    src.split('\n').forEach((line, i) => {
      const trimmed = line.trim()
      // Comments explaining the bug mention `new Map()` too — don't report those.
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
      if (re.test(line)) {
        problems.push({ file, line: i + 1, name: g, text: trimmed.slice(0, 100) })
      }
    })
  }
}

if (problems.length > 0) {
  console.error('\nlucide-react icon is shadowing a global constructor:\n')
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`)
    console.error(`    ${p.text}`)
    console.error(`    "${p.name}" here is the lucide icon, not the global. At runtime this throws`)
    console.error(`    "${p.name} is not a constructor" and takes the whole page down.`)
    console.error(`    Fix: import { ${p.name} as ${p.name}Icon } from 'lucide-react'\n`)
  }
  process.exit(1)
}


// ── Ambiguous duplicate modules ────────────────────────────────────
// Two files with the same name and different extensions (foo.js and foo.ts) are a trap:
// an import written without an extension silently picks whichever Vite resolves first
// (.js beats .ts), and the other file becomes dead code that still looks live.
//
// This white-screened the Android build: supabase.js had no fallback config and won,
// while supabase.ts holding the fallbacks was never executed.
const byBase = new Map()
for (const file of files) {
  const m = file.match(/^(.*)\.(m?[jt]s|[jt]sx)$/)
  if (!m) continue
  const [, base, ext] = m
  if (!byBase.has(base)) byBase.set(base, [])
  byBase.get(base).push(ext)
}

const dupes = []
for (const [base, exts] of byBase) {
  if (exts.length < 2) continue
  const name = base.replace(/^src\//, '@/')
  // Only a problem when something imports it WITHOUT an extension.
  const bare = files.filter(f => {
    try { return readFileSync(f, 'utf8').includes(`'${name}'`) } catch { return false }
  })
  if (bare.length > 0) dupes.push({ base, exts, importers: bare.length })
}

if (dupes.length > 0) {
  console.error('\nTwo files share a name, and imports without an extension pick only one:\n')
  for (const d of dupes) {
    console.error(`  ${d.base}.{${d.exts.join(',')}}`)
    console.error(`    imported without an extension in ${d.importers} file(s) — "${d.exts[0]}" wins,`)
    console.error(`    the rest is dead code that still looks live.`)
    console.error(`    Fix: delete the duplicate, or import it with its extension.\n`)
  }
  process.exit(1)
}

console.log('No lucide icon shadows a global, and no module name is ambiguous.')
