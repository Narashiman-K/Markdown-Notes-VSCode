/**
 * Background tints marking where each block starts and ends.
 *
 * Converted documents produce long stretches of Markdown with no visual
 * structure — a table from a spreadsheet runs for two hundred lines and looks
 * exactly like the prose above it. Syntax highlighting colours the *markers*,
 * which does not help when the markers are far off screen. A whole-line tint
 * answers the question you actually have while scrolling: am I still inside
 * that code block?
 *
 * The colours are declared in `contributes.colors` rather than read from
 * settings as hex strings. That costs nothing and gains a lot: they follow the
 * user's theme, high-contrast themes get their own values, and anyone who wants
 * to change one does it through `workbench.colorCustomizations` — the same
 * place they change every other colour in the editor — instead of learning a
 * setting peculiar to this extension.
 */
import * as vscode from 'vscode'
import MarkdownIt from 'markdown-it'

/** The block kinds a user can switch on, and the token that identifies each. */
const KINDS = {
  codeBlock: { colour: 'suprasuta.codeBlockBackground', tokens: ['fence', 'code_block'] },
  blockquote: { colour: 'suprasuta.blockquoteBackground', tokens: ['blockquote_open'] },
  table: { colour: 'suprasuta.tableBackground', tokens: ['table_open'] },
  heading: { colour: 'suprasuta.headingBackground', tokens: ['heading_open'] }
} as const

type Kind = keyof typeof KINDS

// html:false matters here as much as in the preview: the tokeniser must agree
// with the renderer about where blocks begin, and an HTML block would otherwise
// swallow content the preview treats as Markdown.
const md = new MarkdownIt({ html: false, linkify: false, typographer: false })

const decorations = new Map<Kind, vscode.TextEditorDecorationType>()

function decorationFor(kind: Kind): vscode.TextEditorDecorationType {
  let existing = decorations.get(kind)
  if (!existing) {
    existing = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor(KINDS[kind].colour),
      isWholeLine: true,
      // Survives a split: the same document tinted the same way in both panes,
      // which matters once the preview sits beside the editor.
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    })
    decorations.set(kind, existing)
  }
  return existing
}

/**
 * Finds the line ranges of every enabled block kind.
 *
 * markdown-it hands back `token.map` as `[firstLine, lastLinePlusOne]` for
 * block-level tokens, which is the whole reason this is parsed rather than
 * matched with regular expressions. A regex for a code fence has to guess about
 * fences inside blockquotes, indented code, and ``` appearing in prose; the
 * parser already knows.
 */
function rangesFor(text: string, enabled: readonly Kind[]): Map<Kind, vscode.Range[]> {
  const found = new Map<Kind, vscode.Range[]>()
  for (const kind of enabled) found.set(kind, [])

  let tokens
  try {
    tokens = md.parse(text, {})
  } catch {
    // A parse failure must not take the editor with it. No tints is a fine
    // outcome; an error notification on every keystroke is not.
    return found
  }

  for (const token of tokens) {
    if (!token.map) continue
    for (const kind of enabled) {
      if ((KINDS[kind].tokens as readonly string[]).includes(token.type)) {
        const [start, end] = token.map
        found.get(kind)!.push(new vscode.Range(start, 0, Math.max(start, end - 1), 0))
      }
    }
  }
  return found
}

function enabledKinds(): Kind[] {
  const configured = vscode.workspace
    .getConfiguration('suprasuta')
    .get<string[]>('highlightBlocks', ['codeBlock', 'blockquote'])
  return configured.filter((k): k is Kind => k in KINDS)
}

function apply(editor: vscode.TextEditor | undefined): void {
  if (!editor || editor.document.languageId !== 'markdown') return

  const enabled = enabledKinds()
  const ranges = rangesFor(editor.document.getText(), enabled)

  // Every kind is set on each pass, including the ones now switched off —
  // setting an empty array is what clears a decoration, and skipping the
  // disabled ones would leave their tints behind until the file was reopened.
  for (const kind of Object.keys(KINDS) as Kind[]) {
    editor.setDecorations(decorationFor(kind), ranges.get(kind) ?? [])
  }
}

export function registerBlockTints(context: vscode.ExtensionContext): void {
  let pending: NodeJS.Timeout | undefined

  /*
   * Debounced because this reparses the document, and a converted EPUB can be
   * hundreds of kilobytes. 150ms is below what reads as lag while typing and
   * well above the cost of a parse.
   */
  const schedule = (editor = vscode.window.activeTextEditor): void => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => apply(editor), 150)
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => apply(editor)),

    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) schedule()
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('suprasuta.highlightBlocks')) {
        for (const editor of vscode.window.visibleTextEditors) apply(editor)
      }
    }),

    new vscode.Disposable(() => {
      if (pending) clearTimeout(pending)
      for (const d of decorations.values()) d.dispose()
      decorations.clear()
    })
  )

  // Whatever is already open when the extension wakes up.
  for (const editor of vscode.window.visibleTextEditors) apply(editor)
}
