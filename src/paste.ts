/**
 * Paste from Word, Outlook, a browser or a spreadsheet, and keep the shape.
 *
 * Copying a table out of Word and pasting it into a Markdown file normally
 * gives a wall of tab-separated text, because the editor takes the plain-text
 * flavour of the clipboard and ignores the rest. Every one of those
 * applications also puts an HTML flavour on the clipboard, which still has the
 * headings, the emphasis, the links and the table structure in it. This reads
 * that instead and converts it the same way the document converters do.
 *
 * It uses the very same `htmlToMarkdown` the converters use, deliberately.
 * Pasting a table and converting a document that contains one should not
 * produce two different flavours of Markdown in the same file.
 *
 * VS Code renders the chooser itself. A provider that returns an edit adds it
 * to the list of paste options alongside the built-in plain-text paste, and
 * the editor shows the small widget at the paste point — the same affordance
 * Word has. There is no picker to build.
 */
import * as vscode from 'vscode'
import { htmlToMarkdown } from './lib/convert/html'
import { installNodeRuntime } from './runtime/node'

/*
 * Turndown needs a DOMParser, which the extension host does not have.
 *
 * `convert.ts` installs the jsdom shim as an import side effect, and today
 * that module happens to be loaded first, so this works either way. Depending
 * on import order for whether a feature functions is the kind of thing that
 * breaks silently during an unrelated refactor, and the call is idempotent.
 */
installNodeRuntime()

/**
 * Clipboard HTML is rarely a clean fragment.
 *
 * Word and Excel wrap their output in a full document with a `<meta>` charset,
 * conditional comments and several kilobytes of mso styles; browsers add
 * `<!--StartFragment-->` markers around the part that was actually selected.
 * Turndown copes with most of it, but the fragment markers matter: without
 * trimming to them, a copy from a web page can drag in surrounding navigation
 * that was never highlighted.
 */
function fragment(html: string): string {
  const start = html.indexOf('<!--StartFragment-->')
  const end = html.indexOf('<!--EndFragment-->')
  if (start === -1 || end <= start) return html

  const slice = html.slice(start + '<!--StartFragment-->'.length, end)

  /*
   * Refuse a slice that orphans rows or list items.
   *
   * Excel puts the markers *inside* the table, wrapped around the rows, so
   * trimming to them yields bare `<tr>` elements with no table around them.
   * A `<tr>` outside a table is invalid, and the parser discards it silently,
   * keeping only the text and links inside — which turned a copied
   * spreadsheet into one run-on paragraph while looking, from the code's
   * point of view, like a perfectly successful conversion.
   */
  const orphaned = /<(tr|td|th|li|dt|dd)\b/i.test(slice) && !/<(table|ul|ol|dl)\b/i.test(slice)
  return orphaned ? html : slice
}

/**
 * Gives heading-less tables a heading row, so spreadsheets survive.
 *
 * The GFM rules only recognise a table that already has a `<thead>`; anything
 * else is left as raw HTML. Excel and Google Sheets both emit plain
 * `<tr><td>`, so pasting a block of cells produced the worst result of any
 * source.
 */
function promoteHeaderRows(html: string): string {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return html
  }

  for (const table of Array.from(doc.querySelectorAll('table'))) {
    if (table.querySelector('thead')) continue

    const first = table.querySelector('tr')
    if (!first || first.children.length === 0) continue

    const head = doc.createElement('thead')
    const row = doc.createElement('tr')
    for (const cell of Array.from(first.children)) {
      const th = doc.createElement('th')
      th.innerHTML = cell.innerHTML
      row.appendChild(th)
    }
    head.appendChild(row)

    first.remove()
    table.insertBefore(head, table.firstChild)
  }

  return doc.body.innerHTML
}

class SmartPasteProvider implements vscode.DocumentPasteEditProvider {
  async provideDocumentPasteEdits(
    _document: vscode.TextDocument,
    _ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    _context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    const item = dataTransfer.get('text/html')
    if (!item) return undefined

    const html = await item.asString()
    if (token.isCancellationRequested || !html.trim()) return undefined

    let markdown: string
    try {
      markdown = htmlToMarkdown(promoteHeaderRows(fragment(html))).trim()
    } catch {
      // A malformed clipboard should fall back to VS Code's ordinary paste,
      // not raise an error over something as routine as Ctrl+V.
      return undefined
    }

    if (!markdown) return undefined

    /*
     * Offering nothing when the result matches the plain text is deliberate.
     *
     * Copying a single unformatted word still carries an HTML flavour, and
     * showing a paste chooser for it would put a widget on screen every time
     * anyone pasted anything. The chooser should appear when there is a real
     * choice to make.
     */
    const plain = await dataTransfer.get('text/plain')?.asString()
    if (plain !== undefined && plain.trim() === markdown) return undefined

    const edit = new vscode.DocumentPasteEdit(
      markdown,
      'Paste with formatting',
      vscode.DocumentDropOrPasteEditKind.Text.append('markdown', 'formatted')
    )

    return [edit]
  }
}

export function registerSmartPaste(context: vscode.ExtensionContext): void {
  /*
   * Guarded rather than raised in `engines`.
   *
   * This API finalised after the minimum editor version this extension
   * declares, and Antigravity and Cursor track their own VS Code bases. A
   * runtime check keeps the extension installable everywhere and quietly drops
   * one feature on an older host, which is much better than refusing to
   * install at all.
   */
  if (typeof vscode.languages.registerDocumentPasteEditProvider !== 'function') return

  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
      { language: 'markdown' },
      new SmartPasteProvider(),
      {
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text],
        pasteMimeTypes: ['text/html']
      }
    )
  )
}
