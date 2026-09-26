/**
 * Suprasūtā Markdown Notes for VS Code.
 *
 * Two things, and deliberately only two:
 *
 *   1. Documents VS Code cannot open — PDF, Word, Excel, PowerPoint,
 *      OpenDocument, EPUB — open in a read-only Markdown preview.
 *   2. Any of them can be converted to a real .md file on request.
 *
 * Conversion happens on this machine. No upload, no account, no Pandoc, no
 * Python. That last part is the whole reason to install it: the existing
 * converter extensions shell out to a tool the user has to install separately.
 */
import * as vscode from 'vscode'
import { basename, convertDocument, isSupported, markdownUriFor } from './convert'
import { DocumentPreviewProvider, VIEW_TYPE } from './preview'
import { registerAgentTool } from './agent'
import { registerBlockTints } from './decorations'
import { registerDraft, registerScrollSync } from './sync'
import { registerSmartPaste } from './paste'

export function activate(context: vscode.ExtensionContext): void {
  // Joins a preview to the draft opened beside it, in both directions.
  registerScrollSync(context)

  // Keeps formatting when pasting from Word, Outlook, a browser or a sheet.
  registerSmartPaste(context)
  // Chat access: a language model tool for Copilot, and a cache file for
  // agents that can only read from disk.
  registerAgentTool(context)

  // Block boundaries made visible in any Markdown file, converted or not.
  registerBlockTints(context)

  context.subscriptions.push(
    DocumentPreviewProvider.register(context),

    vscode.commands.registerCommand('suprasuta.convertToMarkdown', (uri?: vscode.Uri) =>
      convertCommand(uri)
    ),

    // The toolbar button, which resolves its document the same way.
    vscode.commands.registerCommand('suprasuta.convertFromPreview', () => convertCommand(undefined)),

    vscode.commands.registerCommand('suprasuta.editAsMarkdown', (uri?: vscode.Uri) => editCommand(uri)),

    /*
     * Hands the file to whatever application owns it — Word, Excel, a PDF
     * reader. The preview is a convenience, not a replacement, and someone
     * looking at a spreadsheet in Markdown quite reasonably wants the
     * spreadsheet.
     */
    vscode.commands.registerCommand('suprasuta.openInDefaultApp', async (uri?: vscode.Uri) => {
      const target = targetUri(uri)
      if (target) await vscode.env.openExternal(target)
    })
  )
}

/**
 * Works out which document the user means.
 *
 * Three sources, because the command arrives from three places. An explorer
 * right-click passes the URI. The Command Palette passes nothing, and
 * `activeTextEditor` is undefined whenever a custom editor is in front — which
 * is exactly the case here, since previewing a PDF is what makes someone want
 * to convert it. The active tab's input covers that.
 */
function targetUri(passed: vscode.Uri | undefined): vscode.Uri | undefined {
  if (passed) return passed
  if (vscode.window.activeTextEditor) return vscode.window.activeTextEditor.document.uri
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined
  return input?.uri
}

/**
 * The Edit half of the View/Edit toggle.
 *
 * A .pdf or .docx cannot be written back to, so Edit necessarily means editing
 * the Markdown. It opens in a real editor tab rather than a text box in the
 * preview, so find and replace, multiple cursors, git and every other editor
 * extension keep working — reimplementing a worse editor inside a webview would
 * be a strange thing to do inside an editor.
 *
 * Nothing is written to disk. The buffer is untitled, but carries the path the
 * file would have, so Ctrl+S offers to save it beside the original with the
 * right name already filled in. Clicking Edit and changing your mind therefore
 * leaves the folder exactly as it was.
 *
 * If a converted file is already sitting there, that one opens instead —
 * offering to create a second copy of a file the user already has would be a
 * small betrayal of what the button says.
 */
async function editCommand(uri: vscode.Uri | undefined): Promise<void> {
  const target = targetUri(uri)
  if (!target || !isSupported(target)) {
    void vscode.window.showWarningMessage('Open a supported document first, then choose Edit.')
    return
  }

  /*
   * Beside, not on top.
   *
   * Edit used to replace the preview in the same slot, which made View and
   * Edit two places you alternated between. Side by side is what the request
   * was actually for: read the rendered version, fix the source next to it,
   * and watch both scroll together.
   */
  const column = vscode.ViewColumn.Beside

  const beside = markdownUriFor(target)
  try {
    await vscode.workspace.fs.stat(beside)
    const existing = await vscode.workspace.openTextDocument(beside)
    await vscode.window.showTextDocument(existing, { preview: false, viewColumn: column })
    registerDraft(existing.uri, target)
    return
  } catch {
    // Nothing saved yet, which is the normal case.
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Opening ${basename(target)} for editing…` },
    async () => {
      try {
        const { markdown } = await convertDocument(target)

        // `untitled:` with a concrete path is what makes the save dialog
        // default to report.pdf.md next to the original, and what gives the
        // buffer Markdown syntax highlighting without setting a language.
        const draft = await vscode.workspace.openTextDocument(beside.with({ scheme: 'untitled' }))
        const editor = await vscode.window.showTextDocument(draft, { preview: false, viewColumn: column })
        await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), markdown))
        registerDraft(draft.uri, target)
      } catch (err) {
        void vscode.window.showErrorMessage(String((err as Error)?.message ?? err))
      }
    }
  )
}

async function convertCommand(uri: vscode.Uri | undefined): Promise<void> {
  const target = targetUri(uri)
  if (!target) {
    void vscode.window.showWarningMessage(
      'Open or select a document first, then run Convert to Markdown.'
    )
    return
  }

  if (!isSupported(target)) {
    void vscode.window.showWarningMessage(
      `Suprasūtā cannot convert .${target.path.split('.').pop()} files.`
    )
    return
  }

  const config = vscode.workspace.getConfiguration('suprasuta')
  const askWhere = config.get<string>('convertedFileLocation') === 'askEachTime'

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Converting ${basename(target)}…` },
    async () => {
      try {
        const { markdown } = await convertDocument(target)

        let destination = markdownUriFor(target)
        if (askWhere) {
          const chosen = await vscode.window.showSaveDialog({
            defaultUri: destination,
            filters: { Markdown: ['md'] }
          })
          if (!chosen) return
          destination = chosen
        } else {
          destination = await freeName(destination, markdown)
        }

        await vscode.workspace.fs.writeFile(destination, Buffer.from(markdown, 'utf8'))

        if (config.get<boolean>('openAfterConverting', true)) {
          const doc = await vscode.workspace.openTextDocument(destination)
          await vscode.window.showTextDocument(doc, { preview: false })
        } else {
          void vscode.window.showInformationMessage(`Saved ${basename(destination)}`)
        }
      } catch (err) {
        void vscode.window.showErrorMessage(String((err as Error)?.message ?? err))
      }
    }
  )
}

/**
 * Avoids destroying an existing file, without producing numbered clutter.
 *
 * Converting the same document twice is normal — someone reopens it a week
 * later — and numbering every attempt gave report.md, report-2.md, report-3.md
 * in testing. If what is already there is exactly what would be written, that
 * file is the result. Numbering is reserved for output that genuinely differs.
 */
async function freeName(preferred: vscode.Uri, markdown: string): Promise<vscode.Uri> {
  const stem = preferred.path.replace(/\.md$/i, '')
  let candidate = preferred

  for (let n = 2; ; n++) {
    let existing: Uint8Array
    try {
      existing = await vscode.workspace.fs.readFile(candidate)
    } catch {
      return candidate
    }
    if (Buffer.from(existing).toString('utf8') === markdown) return candidate
    candidate = preferred.with({ path: `${stem}-${n}.md` })
  }
}

export function deactivate(): void {
  // Nothing to clean up: no processes, no watchers, no temporary files.
}

export { VIEW_TYPE }
