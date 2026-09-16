/**
 * Read-only preview of a document, rendered as Markdown.
 *
 * VS Code cannot open a PDF, Word file or spreadsheet at all — it shows "binary
 * file not shown". This registers as the default editor for those formats so
 * that opening one does something useful, and deliberately writes nothing next
 * to the document: previewing is the non-committal option.
 *
 * The `.md` format is left alone. VS Code's own Markdown preview is good, it is
 * what people already use, and replacing it uninvited is how extensions collect
 * one-star reviews.
 *
 * ---
 *
 * The actions live in a bar at the top of the preview, not only as an icon in
 * the editor title bar. The first version had just the icon, and it failed the
 * only test that matters: someone who had not read the documentation could not
 * tell what it was for. An unlabelled glyph among five other unlabelled glyphs
 * is not a feature anyone will find.
 */
import * as vscode from 'vscode'
import MarkdownIt from 'markdown-it'
import { basename, convertDocument } from './convert'
import { cachePreview } from './agent'

export const VIEW_TYPE = 'suprasuta.documentPreview'

/**
 * Commands the preview is allowed to invoke through `command:` links.
 *
 * An allowlist rather than `true`. The preview renders somebody's document, and
 * a document is untrusted input — a file containing a link to
 * `command:workbench.action.terminal.new` must not be able to run it. Two
 * layers guard that: this list, and `validateLink` below, which refuses any
 * link in the document body that is not plain http(s).
 */
const ALLOWED_COMMANDS = [
  'suprasuta.convertFromPreview',
  'suprasuta.openInDefaultApp'
] as const

/**
 * `typographer` and `linkify` are off on purpose, matching the desktop app.
 * They rewrite characters — quotes, dashes, bare URLs — so the rendered text
 * stops being a character-for-character subset of the source, which is what the
 * annotation offset mapping depends on. Nothing here uses that yet, but the
 * renderers should not quietly disagree between products.
 */
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false })

const defaultValidateLink = md.validateLink.bind(md)
md.validateLink = (url: string): boolean => {
  // Nothing from inside a converted document may be a command or script link.
  if (/^\s*(command|javascript|data|vbscript):/i.test(url)) return false
  return defaultValidateLink(url)
}

interface PreviewDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri
}

export class DocumentPreviewProvider implements vscode.CustomReadonlyEditorProvider<PreviewDocument> {
  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(VIEW_TYPE, new DocumentPreviewProvider(), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    })
  }

  openCustomDocument(uri: vscode.Uri): PreviewDocument {
    return { uri, dispose: () => undefined }
  }

  async resolveCustomEditor(document: PreviewDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = { enableScripts: false, enableCommandUris: [...ALLOWED_COMMANDS] }

    let disposed = false
    panel.onDidDispose(() => {
      disposed = true
    })

    const name = basename(document.uri)

    /*
     * `webview.html` is assigned exactly once, after the conversion finishes.
     *
     * The obvious version writes a "Reading…" page first and replaces it with
     * the result, and that is what produced "Could not register service
     * worker: the document is in an invalid state". VS Code registers a
     * service worker for each webview iframe to serve its resources;
     * reassigning `html` tears the iframe document down, and if the previous
     * registration has not resolved yet Chromium rejects it and the panel
     * renders nothing at all. Progress is reported in the status bar instead,
     * which costs the user nothing and removes the whole failure mode.
     */
    let body: string
    try {
      const { markdown } = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Reading ${name}…` },
        () => convertDocument(document.uri)
      )
      const cached = await cachePreview(document.uri, markdown)
      body = actionBar(name, cached) + md.render(markdown)
    } catch (err) {
      body =
        actionBar(name, undefined, true) +
        status(`Could not read ${escapeHtml(name)}`, escapeHtml(String((err as Error)?.message ?? err)))
    }

    // Closing the tab during a long conversion is normal; writing to a
    // disposed panel throws.
    if (disposed) return
    panel.webview.html = page(name, body)
  }
}

/**
 * The bar at the top of every preview.
 *
 * Written to be understood without instructions: it says what you are looking
 * at, that nothing was uploaded, and offers the two things anyone would want —
 * keep it as a file, or open it in the application it came from.
 */
function actionBar(name: string, cached: vscode.Uri | undefined, failed = false): string {
  const save = `command:suprasuta.convertFromPreview`
  const open = `command:suprasuta.openInDefaultApp`

  return `<div class="bar">
    <div class="bar-text">
      <div class="bar-title">${escapeHtml(name)}</div>
      <div class="bar-sub">${
        failed
          ? 'This document could not be read.'
          : 'Preview only &middot; converted on your computer &middot; nothing uploaded, nothing saved'
      }</div>
    </div>
    <div class="bar-actions">
      ${failed ? '' : `<a class="btn primary" href="${save}" title="Creates ${escapeHtml(name)}.md next to the original">Save as Markdown file</a>`}
      <a class="btn" href="${open}" title="Open in the application this file belongs to">Open in its own app</a>
    </div>
  </div>
  ${
    cached
      ? `<div class="hint">Chat can read this document: type <code>#document</code> in Copilot, or point any agent at
         <code>${escapeHtml(cached.fsPath)}</code></div>`
      : ''
  }`
}

function status(title: string, detail: string): string {
  return `<div class="status"><div><strong>${title}</strong>${detail}</div></div>`
}

function page(title: string, body: string): string {
  /*
   * Scripts stay disabled. markdown-it runs with html:false so embedded HTML in
   * the document is escaped rather than executed, and the policy below is the
   * second layer under that.
   */
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
<title>${escapeHtml(title)}</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.6;
    padding: 0 32px 64px;
    max-width: 62rem;
    margin: 0 auto;
  }

  /* Sticky so the actions stay reachable in a long document. */
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    gap: 12px 16px;
    align-items: center;
    justify-content: space-between;
    padding: 14px 0 14px;
    margin-bottom: 4px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .bar-title { font-size: 1.05em; font-weight: 600; }
  .bar-sub { color: var(--vscode-descriptionForeground); font-size: .88em; margin-top: 2px; }
  .bar-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  .btn {
    display: inline-block;
    padding: 6px 14px;
    border-radius: 4px;
    font-size: .92em;
    text-decoration: none;
    white-space: nowrap;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn.primary:hover { background: var(--vscode-button-hoverBackground); }

  .hint {
    color: var(--vscode-descriptionForeground);
    font-size: .85em;
    margin: 10px 0 20px;
  }
  .hint code {
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 5px;
    border-radius: 3px;
  }

  h1, h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 .5em; }
  h1 { font-size: 1.9em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: .3em; }
  h2 { font-size: 1.45em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: .25em; }
  a { color: var(--vscode-textLink-foreground); }
  code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textCodeBlock-background);
    padding: .15em .35em;
    border-radius: 3px;
    font-size: .92em;
  }
  pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 12px 14px;
    border-radius: 4px;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid var(--vscode-textBlockQuote-border);
    background: var(--vscode-textBlockQuote-background);
    margin: 1em 0;
    padding: .5em 1em;
  }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 6px 10px; text-align: left; }
  th { background: var(--vscode-editorWidget-background); font-weight: 600; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 2em 0; }
  .status {
    color: var(--vscode-descriptionForeground);
    display: grid;
    place-items: center;
    min-height: 50vh;
    text-align: center;
  }
  .status strong { display: block; color: var(--vscode-foreground); margin-bottom: .5em; }
</style>
</head>
<body>${body}</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
