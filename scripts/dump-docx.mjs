import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { convertOne } = await import(pathToFileURL(join(root, 'dist', 'verify.js')).href)
const r = await convertOne(new Uint8Array(await readFile(join(root, 'samples', 'sample.docx'))), 'sample.docx')
await writeFile(process.argv[2], r.markdown, 'utf8')
console.log('len', r.markdown.length)
