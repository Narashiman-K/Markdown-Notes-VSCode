/**
 * Tables of contents, the same way the Suprasūtā app writes them:
 *
 *   <!-- toc -->
 *   - [Introduction](#introduction)
 *     - [Background](#background)
 *   <!-- /toc -->
 *
 * "Insert table of contents" puts one at the cursor. With
 * `suprasuta.updateTableOfContentsOnSave` on (the default), saving brings an
 * existing one up to date with the headings. Any Markdown viewer shows it as an
 * ordinary list of links; the markers are invisible.
 */
import * as vscode from 'vscode'

export const TOC_START = '<!-- toc -->'
export const TOC_END = '<!-- /toc -->'
const BLOCK = /<!-- toc -->\r?\n[\s\S]*?<!-- \/toc -->/

/** GitHub-style heading anchors, as VS Code's preview and GitHub both make them. */
export function slug(text: string, used: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s/g, '-') || 'section'
  const n = used.get(base) ?? 0
  used.set(base, n + 1)
  return n ? `${base}-${n}` : base
}

const plain = (t: string): string =>
  t
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim()

/** The list of links, without the document's single title heading. */
export function tocList(markdown: string): string {
  const lines = markdown.replace(BLOCK, '').split(/\r?\n/)
  const heads: Array<{ level: number; text: string }> = []
  let fence = false
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const m = !fence && l.match(/^(#{1,6})\s+(.+)$/)
    if (m) heads.push({ level: m[1].length, text: plain(m[2]) })
  }
  const titles = heads.filter((h) => h.level === 1).length
  const list = titles === 1 ? heads.filter((h) => h.level > 1) : heads
  if (!list.length) return ''
  const top = Math.min(...list.map((h) => h.level))
  const used = new Map<string, number>()
  // Slugs are counted over every heading, in order, as the preview does.
  const slugs = new Map<(typeof heads)[number], string>()
  for (const h of heads) slugs.set(h, slug(h.text, used))
  return list.map((h) => `${'  '.repeat(Math.min(h.level - top, 5))}- [${h.text}](#${slugs.get(h)})`).join('\n')
}

export function tocBlock(markdown: string): string {
  return `${TOC_START}\n${tocList(markdown)}\n${TOC_END}`
}

/** The document with its contents block brought up to date; unchanged without one. */
export function refreshToc(markdown: string): string {
  if (!BLOCK.test(markdown)) return markdown
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  return markdown.replace(BLOCK, tocBlock(markdown).replace(/\n/g, eol))
}

export function registerToc(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('suprasuta.insertTableOfContents', (editor) => {
      const doc = editor.document
      const text = doc.getText()
      if (BLOCK.test(text)) {
        const next = refreshToc(text)
        void editor.edit((b) => b.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), next))
        void vscode.window.setStatusBarMessage('Table of contents updated', 2500)
        return
      }
      const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'
      void editor.edit((b) => b.insert(editor.selection.active, `${tocBlock(text).replace(/\n/g, eol)}${eol}`))
    }),

    vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.languageId !== 'markdown') return
      if (!vscode.workspace.getConfiguration('suprasuta').get<boolean>('updateTableOfContentsOnSave', true)) return
      const text = e.document.getText()
      const next = refreshToc(text)
      if (next === text) return
      e.waitUntil(Promise.resolve([vscode.TextEdit.replace(new vscode.Range(e.document.positionAt(0), e.document.positionAt(text.length)), next)]))
    })
  )
}
