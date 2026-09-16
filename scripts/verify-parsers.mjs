/**
 * Proves that dropping jsdom changed nothing.
 *
 * The MCP server converts the same sample files with jsdom and produces exactly
 * these lengths. Swapping in domino for HTML and xmldom for XML is only safe if
 * the output is identical — an HTML parser silently lowercasing `<text:p>`
 * would not throw, it would just return a shorter, emptier document, which is
 * precisely the kind of regression a character count catches and a smoke test
 * does not.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Produced by the MCP server, the canonical copy of the converters.
 *
 * Regenerate these when a converter dependency moves: a mammoth or turndown
 * bump legitimately changes the output by a few characters, and a stale number
 * here reads as a regression in whatever was being tested at the time.
 * `node scripts/dump-docx.mjs out.md` in either project prints the current one.
 */
const EXPECTED = {
  'sample.docx': 341,
  'sample.pdf': 222,
  'sample.xlsx': 179,
  'sample.pptx': 207,
  'sample.odt': 178,
  'sample.epub': 135
}

const { convertOne } = await import(pathToFileURL(join(root, 'dist', 'verify.js')).href)

let failures = 0
for (const [name, expected] of Object.entries(EXPECTED)) {
  const bytes = new Uint8Array(await readFile(join(root, 'samples', name)))
  const r = await convertOne(bytes, name)

  if (!r.ok) {
    console.log(`FAILED  ${name.padEnd(13)} ${r.code}: ${r.error}`)
    failures++
    continue
  }
  const got = r.markdown.length
  const ok = got === expected
  if (!ok) failures++
  console.log(`${ok ? 'ok    ' : 'DIFFER'}  ${name.padEnd(13)} ${String(got).padStart(5)} chars (jsdom gave ${expected})`)
}

console.log(failures ? `\n${failures} format(s) differ from the jsdom build.` : '\nIdentical to the jsdom build.')
process.exit(failures ? 1 : 0)
