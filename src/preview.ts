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
import { randomBytes } from 'node:crypto'
import MarkdownIt from 'markdown-it'
import { basename, convertDocument } from './convert'
import { cachePreview } from './agent'
import { registerPreview } from './sync'

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
  'suprasuta.editAsMarkdown',
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

/*
 * Stamps each block element with the source line it came from.
 *
 * This is what lets the preview and the editor scroll together: markdown-it
 * already tracks `token.map` for block tokens, so nothing has to be inferred
 * from the rendered HTML.
 *
 * Only top-level tokens are walked; inline content has no map of its own, and
 * line-level precision is all scroll syncing can use.
 */
md.core.ruler.push('suprasuta_source_lines', (state) => {
  for (const token of state.tokens) {
    // nesting 1 opens a tag and 0 is self-closing; -1 is a closing tag, which
    // carries no attributes.
    if (token.map && token.nesting >= 0) token.attrSet('data-line', String(token.map[0]))
  }
})

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
    /*
     * Scripts are on, which they were not before, because a webview cannot
     * report its own scroll position without them.
     *
     * The document being rendered is untrusted — it is somebody's PDF — so the
     * protection is layered rather than removed. markdown-it runs with
     * html:false, so any HTML inside the document is escaped as text and never
     * parsed. The policy below admits exactly one script, identified by a
     * nonce generated per render, and nothing else: no inline handlers, no
     * external anything, no eval. `enableCommandUris` stays an allowlist of
     * two commands rather than `true`.
     */
    panel.webview.options = { enableScripts: true, enableCommandUris: [...ALLOWED_COMMANDS] }
    registerPreview(document.uri, panel)

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
 * The toolbar at the top of every preview.
 *
 * Three controls, each with a word on it, because the first version was an
 * unlabelled glyph in the editor title bar and nobody could tell what it was
 * for. The bar has to be readable by someone who has never opened the
 * documentation and is not going to.
 *
 * View/Edit is a segmented pair rather than two buttons: it says, without a
 * sentence of explanation, that these are two states of one thing and that you
 * are currently in the first. View is inert — it is where you already are.
 *
 * Everything here is an ordinary link to a `command:` URI, because the webview
 * runs with scripts disabled and will keep doing so. It is rendering somebody's
 * document, and a document is untrusted input.
 */
function actionBar(name: string, cached: vscode.Uri | undefined, failed = false): string {
  if (failed) {
    return `<div class="bar">
      <div class="seg"><span class="seg-item active">View</span></div>
      <a class="btn ghost" href="command:suprasuta.openInDefaultApp">Open original</a>
    </div>
    <div class="bar-sub">${escapeHtml(name)} &middot; could not be read</div>`
  }

  return `<div class="bar">
    <a class="btn primary" href="command:suprasuta.convertFromPreview"
       title="Writes ${escapeHtml(name)}.md next to the original document">${SAVE_ICON}Save as .md</a>

    <div class="seg" role="group">
      <span class="seg-item active" title="You are reading the document">View</span>
      <a class="seg-item" href="command:suprasuta.editAsMarkdown"
         title="Open the text in an editable tab. Nothing is written until you save.">Edit</a>
    </div>

    <a class="btn ghost" href="command:suprasuta.openInDefaultApp"
       title="Open in the application this file belongs to">${APP_ICON}Open original</a>
  </div>
  <div class="bar-sub">
    <strong>${escapeHtml(name)}</strong> &middot; converted on your computer &middot; nothing uploaded${
      cached
        ? ` &middot; chat can read it: type <code>#document</code>, or point an agent at <code>${escapeHtml(cached.fsPath)}</code>`
        : ''
    }
  </div>`
}

// Inline SVG rather than a file: no resource is fetched, so the strict
// Content-Security-Policy below needs no exception for it.
const SAVE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M3 2h8.5L14 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm1 1v3h6V3H4zm4 5.5A2.5 2.5 0 1 0 8 13.5a2.5 2.5 0 0 0 0-5z"/></svg>'

const APP_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M9 2h5v5h-1.5V4.56L7.53 9.53 6.47 8.47l4.97-4.97H9V2zM3 4h4v1.5H3.5v7h7V9H12v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>'

function status(title: string, detail: string): string {
  return `<div class="status"><div><strong>${title}</strong>${detail}</div></div>`
}

function page(title: string, body: string): string {
  /*
   * One script, admitted by a nonce that changes on every render, and nothing
   * else. No external sources, no eval, no inline event handlers — an
   * attribute like onclick="..." inside a converted document would be refused
   * by this policy even if it survived markdown-it's html:false escaping.
   */
  const nonce = randomBytes(16).toString('base64')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}';">
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
    gap: 10px;
    align-items: center;
    padding: 10px 0;
    background: var(--vscode-editor-background);
  }
  /* Pushes "Open original" to the far right, away from the two primary
     controls, so the grouping reads as: act on it | look at it | leave. */
  .bar .ghost { margin-left: auto; }

  .bar-sub {
    position: sticky;
    top: 48px;
    z-index: 10;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: .85em;
    padding-bottom: 10px;
    margin-bottom: 8px;
  }
  .bar-sub strong { color: var(--vscode-foreground); }
  .bar-sub code {
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
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
  .btn.ghost {
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border-color: var(--vscode-panel-border);
  }
  .btn.ghost:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
  }

  /* The View | Edit pair. One outline around both, the current one filled. */
  .seg {
    display: inline-flex;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    overflow: hidden;
  }
  .seg-item {
    padding: 5px 16px;
    font-size: .92em;
    text-decoration: none;
    white-space: nowrap;
    color: var(--vscode-foreground);
  }
  .seg-item + .seg-item { border-left: 1px solid var(--vscode-panel-border); }
  .seg-item.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-weight: 600;
  }
  a.seg-item:hover { background: var(--vscode-toolbar-hoverBackground); }

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
<body>${body}
<script nonce="${nonce}">
/*
 * Scroll reporting, and nothing else.
 *
 * The anchors are the data-line attributes stamped on each block. Positions
 * are interpolated between them rather than snapped to the nearest, so a long
 * code block scrolls smoothly instead of the other pane jumping a screen at a
 * time when its first line finally passes the top edge.
 */
(function () {
  const vscode = acquireVsCodeApi()
  let anchors = []
  let stale = true
  let echo = false

  function rebuild() {
    anchors = []
    for (const el of document.querySelectorAll('[data-line]')) {
      const line = Number(el.dataset.line)
      if (Number.isFinite(line)) anchors.push({ line: line, top: el.offsetTop })
    }
    // Without a starting point the first screenful has nothing to interpolate
    // from, and everything above the first heading maps to line zero anyway.
    if (!anchors.length || anchors[0].line > 0) anchors.unshift({ line: 0, top: 0 })
    anchors.sort(function (a, b) { return a.top - b.top })
    stale = false
  }

  /** Linear interpolation between the two anchors bracketing a value. */
  function between(value, from, to) {
    if (stale) rebuild()
    if (!anchors.length) return 0
    let lo = 0, hi = anchors.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (anchors[mid][from] <= value) lo = mid; else hi = mid - 1
    }
    const a = anchors[lo], b = anchors[lo + 1]
    if (!b) return a[to]
    const span = b[from] - a[from]
    if (span <= 0) return a[to]
    const ratio = Math.min(1, Math.max(0, (value - a[from]) / span))
    return a[to] + (b[to] - a[to]) * ratio
  }

  addEventListener('resize', function () { stale = true })
  // Images and web fonts finishing late change every offset below them.
  addEventListener('load', function () { stale = true }, true)

  addEventListener('scroll', function () {
    if (echo) return
    vscode.postMessage({ type: 'scrolled', line: between(scrollY, 'top', 'line') })
  }, { passive: true })

  addEventListener('message', function (event) {
    const message = event.data
    if (!message || message.type !== 'revealLine') return
    echo = true
    scrollTo({ top: between(message.line, 'line', 'top') })
    // Cleared on the next frame, which is when the browser has finished
    // dispatching the scroll this caused. Without it the two panes push each
    // other along and drift apart.
    requestAnimationFrame(function () { echo = false })
  })
}())
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
