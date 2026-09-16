/**
 * Bundles the extension.
 *
 * esbuild rather than `tsc` for two reasons. It resolves the extensionless
 * relative imports the app copies use, so `src/lib/convert/` can stay
 * byte-identical to the Windows and web versions instead of being rewritten
 * with `.js` suffixes for Node's resolver. And it lets the `?url` import below
 * be handled here rather than by editing a shared file.
 */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

/**
 * Vite lets a module be imported for its URL with a `?url` suffix. Node has no
 * such concept, and `pdf.ts` uses it to locate the pdf.js worker.
 *
 * It resolves to the worker's absolute path here. In practice pdf.js detects
 * Node and runs on the main thread regardless of what `workerSrc` is set to, so
 * this value is never actually fetched — but an honest path is better than a
 * placeholder that would mislead anyone debugging it.
 */
const urlImports = {
  name: 'url-imports',
  setup(b) {
    b.onResolve({ filter: /\?url$/ }, (args) => ({
      path: args.path.replace(/\?url$/, ''),
      namespace: 'url-import'
    }))
    b.onLoad({ filter: /.*/, namespace: 'url-import' }, (args) => {
      let resolved
      try {
        resolved = require.resolve(args.path)
      } catch {
        resolved = args.path
      }
      // A bare Windows path such as D:\\... is not a URL, and Node's ESM
      // loader rejects it with "protocol 'd:'". pdf.js import()s this value.
      const href = pathToFileURL(resolved).href
      return { contents: `export default ${JSON.stringify(href)}`, loader: 'js' }
    })
  }
}

await build({
  entryPoints: ['src/extension.ts', 'src/verify.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  /*
   * CommonJS, not ESM: VS Code loads an extension with require(), and an ESM
   * entry point simply will not load.
   */
  format: 'cjs',
  /*
   * Almost everything is bundled, which is unusual for this codebase but right
   * here.
   *
   * `vscode` is provided by the host and must never be bundled. `jsdom` uses
   * dynamic requires that a bundler cannot follow, so it stays in node_modules.
   * Everything else is bundled — pdf.js in particular *has* to be, because its
   * legacy build ships only as ESM and a CommonJS extension cannot require it.
   *
   * The happy side effect is size: a .vsix that ships one dependency instead of
   * a whole tree.
   */
  external: ['vscode', 'jsdom', 'tesseract.js'],
  /*
   * pdf.js prints "Please use the legacy build in Node.js environments" and
   * then trips over modern syntax its main build assumes. Rewriting the
   * specifier here keeps pdf.ts identical to the app copies, which import the
   * plain package name as a browser build should.
   */
  alias: { 'pdfjs-dist': 'pdfjs-dist/legacy/build/pdf.mjs' },
  /*
   * The plugin must be listed even though `packages: 'external'` is set.
   * Without it the `?url` specifier is treated as an ordinary package import,
   * left in the output untouched, and the bundle then fails at runtime rather
   * than at build time — plugin resolution runs before the external check,
   * which is exactly why this works.
   */
  plugins: [urlImports],
  minify: process.argv.includes('--production'),
  sourcemap: !process.argv.includes('--production'),
  logLevel: 'info'
})


