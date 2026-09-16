/**
 * Makes the shared converters run inside the VS Code extension host.
 *
 * `src/lib/convert/` is kept byte-identical to the copies in the Windows, web,
 * Android and MCP projects, so this supplies the browser globals they expect
 * rather than the files being edited to avoid them.
 *
 * Only `DOMParser` is shimmed, deliberately. An earlier version of the MCP
 * server also defined `document`, and that broke text recognition: tesseract.js
 * sniffs for a DOM to decide whether it is in a browser, found one, took the
 * browser branch and died on `window is not defined`. Half a browser is worse
 * than none.
 *
 * ---
 *
 * jsdom is 12 MB and has to ship inside the .vsix, so it was worth trying to
 * avoid. It is not worth avoiding.
 *
 * Substituting domino for HTML and xmldom for XML — both of which bundle into
 * the output file, leaving no runtime dependency at all — broke EPUB outright:
 * `office.ts` calls `querySelector`, and xmldom implements no Selectors API.
 * Every other format converted identically, so the swap failed on one specific
 * missing feature rather than on general incompatibility. Revisit only with a
 * parser that supports both namespaced XML and selectors.
 *
 * Caught by `scripts/verify-parsers.mjs`, which compares output against the MCP
 * build. Worth noting the baseline in that script has to be regenerated when a
 * converter dependency moves — a stale number there briefly made a dependency
 * bump look like a parser regression.
 */
import { JSDOM } from 'jsdom'
import { setConvertRuntime } from '../lib/convert/runtime'

let installed = false

export function installNodeRuntime(): void {
  if (installed) return
  installed = true

  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const g = globalThis as Record<string, unknown>
  g.DOMParser ??= dom.window.DOMParser
  g.XMLSerializer ??= dom.window.XMLSerializer

  setConvertRuntime({
    // mammoth's Node unzip reads `buffer`; only its browser build understands
    // `arrayBuffer`, and the package swaps between them via the browser field.
    docxSource: (bytes) => ({ buffer: Buffer.from(bytes) }),

    /*
     * Text recognition is not part of this extension. Version 1 previews
     * documents rather than images, so the OCR engine is not bundled — which
     * keeps the package tens of megabytes smaller. `convert.ts` refuses image
     * files before anything here could be reached; these stubs exist only so
     * the shared interface is satisfied without pretending to support it.
     */
    tesseractPaths: () => ({}),
    ocrImageInput: (bytes) => Buffer.from(bytes)
  })
}
