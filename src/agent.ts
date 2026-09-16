/**
 * Makes converted documents reachable by chat agents, two ways.
 *
 * 1. A language model tool. Copilot's agent mode calls `convert_document`
 *    directly, so "summarise the contract in this folder" works without the
 *    user converting anything first. Nothing is written to disk.
 *
 * 2. A cache file. Other agents — and anything that can only read files —
 *    get a real .md under the extension's storage folder, written whenever a
 *    document is previewed. The path is stable and printable, so it can be
 *    pasted into a chat that has no tool access.
 *
 * The cache is deliberately outside the workspace. Writing converted copies
 * beside someone's documents without being asked is how a viewer turns into a
 * mess in their git status.
 */
import * as vscode from 'vscode'
import { basename, convertDocument, isSupported, SUPPORTED } from './convert'

let cacheDir: vscode.Uri | undefined

export function initialiseCache(context: vscode.ExtensionContext): void {
  cacheDir = vscode.Uri.joinPath(context.globalStorageUri, 'previews')
}

/**
 * Writes the converted text where an agent can read it, and returns the path.
 *
 * Failures are swallowed on purpose: this is a convenience running alongside a
 * preview the user asked for, and a storage problem should not turn a working
 * preview into an error dialog.
 */
export async function cachePreview(uri: vscode.Uri, markdown: string): Promise<vscode.Uri | undefined> {
  if (!cacheDir || !vscode.workspace.getConfiguration('suprasuta').get<boolean>('cachePreviewsForAgents', true)) {
    return undefined
  }
  try {
    await vscode.workspace.fs.createDirectory(cacheDir)
    const target = vscode.Uri.joinPath(cacheDir, `${basename(uri)}.md`)
    await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, 'utf8'))
    return target
  } catch {
    return undefined
  }
}

interface ConvertInput {
  path: string
}

/**
 * The tool Copilot agent mode calls.
 *
 * `prepareInvocation` supplies the confirmation text VS Code shows before
 * running it. Reading a file is not destructive, so this asks for no
 * confirmation and only reports what it is doing.
 */
class ConvertDocumentTool implements vscode.LanguageModelTool<ConvertInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ConvertInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const raw = options.input?.path
    if (!raw) {
      return message('No file path was given. Pass the absolute path of the document to convert.')
    }

    const uri = vscode.Uri.file(raw)
    if (!isSupported(uri)) {
      return message(
        `Cannot convert ${basename(uri)}. Supported formats: ${SUPPORTED.join(', ')}.`
      )
    }

    try {
      const { markdown } = await convertDocument(uri)
      if (token.isCancellationRequested) return message('Cancelled.')

      /*
       * Truncated for the same reason the MCP server truncates: the whole text
       * of a long document lands in the model's context at full price, and a
       * hundred-page PDF would swallow the conversation. The agent can ask for
       * more by converting to a file and reading it in pieces.
       */
      const LIMIT = 40_000
      if (markdown.length > LIMIT) {
        return message(
          `${markdown.slice(0, LIMIT)}\n\n---\n*Truncated at ${LIMIT.toLocaleString()} of ` +
            `${markdown.length.toLocaleString()} characters. Run "Convert to Markdown" on this file ` +
            `to save the whole document.*`
        )
      }
      return message(markdown)
    } catch (err) {
      return message(`Could not read ${basename(uri)}: ${String((err as Error)?.message ?? err)}`)
    }
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ConvertInput>
  ): vscode.PreparedToolInvocation {
    const name = options.input?.path ? basename(vscode.Uri.file(options.input.path)) : 'the document'
    return { invocationMessage: `Converting ${name} to Markdown on this machine` }
  }
}

function message(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)])
}

export function registerAgentTool(context: vscode.ExtensionContext): void {
  initialiseCache(context)

  /*
   * Guarded because the language model tool API is newer than the editor
   * version this extension supports. On an older VS Code the preview and the
   * convert command still work; only the agent tool is absent.
   */
  if (typeof vscode.lm?.registerTool !== 'function') return

  context.subscriptions.push(vscode.lm.registerTool('suprasuta_convert_document', new ConvertDocumentTool()))
}
