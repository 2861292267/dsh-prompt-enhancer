/**
 * Run every suite in `test/` and print a summary.
 *
 * Each suite is a standalone Node script that prints
 * `RESULT: N passed, M failed` and exits non-zero on failure, so they can also be
 * run individually during development.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(HERE).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs').sort()

let passed = 0
let failed = 0
let crashed = 0

for (const file of files) {
  const result = spawnSync(process.execPath, [join(HERE, file)], { encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const match = /RESULT:\s*(\d+) passed,\s*(\d+) failed/.exec(output)

  if (!match) {
    crashed++
    console.log(`CRASH  ${file}`)
    // Surface the reason instead of only the fact.
    console.log(output.split('\n').slice(0, 8).map((l) => `       ${l}`).join('\n'))
    continue
  }

  const p = Number(match[1])
  const f = Number(match[2])
  passed += p
  failed += f
  console.log(`${f === 0 ? 'PASS ' : 'FAIL '} ${file.padEnd(20)} ${String(p).padStart(3)} passed  ${f} failed`)
}

console.log('')
console.log(`TOTAL ${passed} assertions, ${failed} failed${crashed ? `, ${crashed} suite(s) crashed` : ''}`)
process.exit(failed === 0 && crashed === 0 ? 0 : 1)
