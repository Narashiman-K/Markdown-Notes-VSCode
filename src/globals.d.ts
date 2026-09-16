/**
 * Declarations that exist so the shared converter files type-check unchanged.
 *
 * These describe Vite conventions the app copies rely on. Nothing here affects
 * the emitted output — `scripts/build.mjs` handles the corresponding runtime
 * behaviour — but without them TypeScript would flag code that is correct in
 * the apps, and the pressure to "fix" it here would break byte-identity.
 */

/** Vite's `?url` import, used by pdf.ts to locate the pdf.js worker. */
declare module '*?url' {
  const url: string
  export default url
}

declare module '*?worker' {
  const worker: new () => Worker
  export default worker
}

/**
 * tesseract.js is not a dependency of this extension.
 *
 * `ocr.ts` is shared verbatim with the other projects and imports it
 * dynamically inside the offline-OCR path. This extension previews documents
 * rather than images and refuses image files before that path can be reached,
 * so the module is never loaded — but TypeScript still needs to know the name
 * resolves. Installing the real package for types alone would add tens of
 * megabytes to a package that gains nothing from it.
 */
declare module 'tesseract.js' {
  export const createWorker: (...args: unknown[]) => Promise<{
    recognize: (image: unknown) => Promise<{ data: { text?: string; confidence?: number } }>
    terminate: () => Promise<void>
  }>
}

/**
 * domino ships a `.d.ts` that TypeScript does not recognise as a module, so the
 * one function used here is declared by hand. It arrives as a dependency of
 * turndown, which walks the very documents it produces.
 */
declare module '@mixmark-io/domino' {
  export function createWindow(html: string): { document: unknown }
}
