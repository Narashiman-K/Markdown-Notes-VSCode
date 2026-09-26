/**
 * Keeps a preview and the editable draft it came from showing the same place.
 *
 * The two are separate editors owned by VS Code, not two panes of one widget,
 * so they have to be introduced to each other. A preview registers itself when
 * it opens; the Edit command registers the draft it creates. Everything here
 * is keyed on the *source* document — the .pdf or .docx — because that is the
 * only identifier both sides share.
 *
 * Nothing here holds a document open. Both maps are cleared when their side
 * goes away, and a lookup that finds a disposed panel cleans up after itself.
 */
import * as vscode from 'vscode'

/** Source document → its live preview panel. */
const previews = new Map<string, vscode.WebviewPanel>()

/** Draft editor document → the source document it was converted from. */
const drafts = new Map<string, string>()

/*
 * Suppresses the echo between the two panes.
 *
 * Scrolling A moves B, which fires B's own scroll event, which would move A
 * back. A timestamp rather than a boolean because the two sides are different
 * processes here: the webview's scroll event arrives as a message some
 * milliseconds after the editor moved, so a flag cleared on the next frame —
 * which is enough inside one document — would already be gone.
 */
let lastProgrammaticScroll = 0
const ECHO_WINDOW_MS = 120

const isEcho = (): boolean => Date.now() - lastProgrammaticScroll < ECHO_WINDOW_MS

export function registerPreview(source: vscode.Uri, panel: vscode.WebviewPanel): void {
  const key = source.toString()
  previews.set(key, panel)
  panel.onDidDispose(() => {
    if (previews.get(key) === panel) previews.delete(key)
  })

  panel.webview.onDidReceiveMessage((message: { type?: string; line?: number }) => {
    if (message?.type !== 'scrolled' || typeof message.line !== 'number') return
    if (isEcho()) return

    const editor = editorForSource(key)
    if (!editor) return

    lastProgrammaticScroll = Date.now()
    const line = clampLine(editor.document, message.line)
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop)
  })
}

/**
 * Notes that `draft` holds the Markdown of `source`.
 *
 * Untitled documents get a fresh URI each time one is opened, so this cannot
 * be derived — it has to be recorded at the moment the draft is created.
 */
export function registerDraft(draft: vscode.Uri, source: vscode.Uri): void {
  drafts.set(draft.toString(), source.toString())
}

function editorForSource(sourceKey: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find(
    (editor) => drafts.get(editor.document.uri.toString()) === sourceKey
  )
}

function clampLine(document: vscode.TextDocument, line: number): number {
  return Math.max(0, Math.min(Math.round(line), document.lineCount - 1))
}

/**
 * Starts listening for the editor half of the conversation.
 *
 * `onDidChangeTextEditorVisibleRanges` fires for scrolling, for typing that
 * moves the viewport, and for window resizes — all of which should move the
 * preview, so no filtering is wanted beyond the echo guard.
 */
export function registerScrollSync(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      if (isEcho()) return

      const sourceKey = drafts.get(event.textEditor.document.uri.toString())
      if (!sourceKey) return

      const panel = previews.get(sourceKey)
      if (!panel) return

      const top = event.visibleRanges[0]?.start.line
      if (typeof top !== 'number') return

      lastProgrammaticScroll = Date.now()
      void panel.webview.postMessage({ type: 'revealLine', line: top })
    }),

    // A closed draft should not keep its source keyed forever; the map would
    // grow for the life of the window otherwise.
    vscode.workspace.onDidCloseTextDocument((document) => {
      drafts.delete(document.uri.toString())
    })
  )
}
