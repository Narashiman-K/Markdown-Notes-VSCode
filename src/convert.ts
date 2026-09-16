/**
 * The extension's one entry point into the shared converters.
 *
 * Everything that reads a document goes through here, so the "which formats do
 * we actually support" question has a single answer rather than being implied
 * in three places.
 */
import * as vscode from 'vscode'
import { installNodeRuntime } from './runtime/node'
import { convertToMarkdown, extensionOf } from './lib/convert'
import { AUDIO_EXTS, IMAGE_EXTS } from './shared/formats'

installNodeRuntime()

/**
 * Formats this extension previews and converts.
 *
 * Deliberately narrower than what the converters can do. Images need the OCR
 * engine and audio needs a paid transcription service, neither of which belongs
 * in an editor extension that should install in seconds and work offline. Both
 * are available in the desktop app and the MCP server.
 */
export const SUPPORTED = [
  'pdf',
  'docx',
  'xlsx',
  'xlsm',
  'xls',
  'pptx',
  'odt',
  'ods',
  'epub',
  'csv',
  'tsv'
] as const

export function isSupported(uri: vscode.Uri): boolean {
  return (SUPPORTED as readonly string[]).includes(extensionOf(uri.fsPath))
}

export interface Converted {
  markdown: string
  title: string
}

/**
 * Reads a document and returns Markdown, or throws with a message worth showing
 * to a person.
 */
export async function convertDocument(uri: vscode.Uri): Promise<Converted> {
  const ext = extensionOf(uri.fsPath)

  if (IMAGE_EXTS.includes(ext)) {
    throw new Error(
      'Reading text out of images needs the optical character recognition engine, ' +
        'which this extension does not bundle. The Suprasūtā desktop app and the ' +
        'suprasuta-markdown-mcp server both do it, offline.'
    )
  }
  if (AUDIO_EXTS.includes(ext)) {
    throw new Error(
      'Audio transcription needs a paid AssemblyAI account and is not part of this ' +
        'extension. The Suprasūtā desktop app and the suprasuta-markdown-mcp server ' +
        'both support it.'
    )
  }
  if (!isSupported(uri)) {
    throw new Error(`.${ext} files are not supported. Supported: ${SUPPORTED.join(', ')}.`)
  }

  const bytes = await vscode.workspace.fs.readFile(uri)
  const result = await convertToMarkdown(bytes, basename(uri), {})

  if (!result.ok) throw new Error(result.error)
  return { markdown: result.markdown, title: basename(uri) }
}

export function basename(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? uri.fsPath
}

/**
 * `report.pdf` becomes `report.pdf.md`, keeping the original name in full.
 *
 * Dropping the extension looked tidier until a folder held report.pdf,
 * report.docx and report.epub and all three wanted the same output name.
 */
export function markdownUriFor(uri: vscode.Uri): vscode.Uri {
  return uri.with({ path: `${uri.path}.md` })
}
