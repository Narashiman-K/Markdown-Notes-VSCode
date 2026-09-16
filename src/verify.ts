/**
 * Entry point used only by scripts/verify-parsers.mjs.
 *
 * Bundled separately so the parser swap can be tested through the real build
 * pipeline — same esbuild config, same aliases — without importing `vscode`,
 * which only exists inside the editor.
 */
import { installNodeRuntime } from './runtime/node'
import { convertToMarkdown } from './lib/convert'

installNodeRuntime()

export async function convertOne(bytes: Uint8Array, name: string) {
  return convertToMarkdown(bytes, name, {})
}
