/**
 * Read-only preview of a document, rendered as Markdown.
 *
 * VS Code cannot open a PDF, Word file or spreadsheet at all — it shows "binary
 * file not shown". This registers as the default editor for those formats so
 * that opening one does something useful, and deliberately writes nothing:
 * previewing is the non-committal option, and the title-bar button is there
 * when the user wants an editable file.
 *
 * The `.md` format is left alone. VS Code's own Markdown preview is good, it is
 * what people already use, and replacing it uninvited is how extensions collect
 * one-star reviews.
 */
import * as vscode from 'vscode'
import MarkdownIt from 'markdown-it'
import { basename, convertDocument } from './convert'
import { cachePreview } from './agent'

export const VIEW_TYPE = 'suprasuta.documentPreview'

/**
 * `typographer` and `linkify` are off on purpose, matching the desktop app.
 * They rewrite characters — quotes, dashes, bare URLs — so the rendered text
 * stops being a character-for-character subset of the source, which is exactly
 * what the annotation offset mapping depends on. Nothing here uses that yet,
 * but the renderers should not quietly disagree between products.
 */
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false })

interface PreviewDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri
}

export class DocumentPreviewProvider implements vscode.CustomReadonlyEditorProvider<PreviewDocument> {
  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(VIEW_TYPE, new DocumentPreviewProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    })
  }

  openCustomDocument(uri: vscode.Uri): PreviewDocument {
    return { uri, dispose: () => undefined }
  }

  async resolveCustomEditor(
    document: PreviewDocument,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    panel.webview.options = { enableScripts: false }
    panel.webview.html = this.loadingHtml(basename(document.uri))

    try {
      const { markdown } = await convertDocument(document.uri)
      panel.webview.html = this.renderedHtml(panel.webview, md.render(markdown), basename(document.uri))

      // Written after the preview is on screen: the user is waiting for the
      // document, not for a cache file, and this must never delay it.
      void cachePreview(document.uri, markdown)
    } catch (err) {
      panel.webview.html = this.errorHtml(String((err as Error)?.message ?? err), basename(document.uri))
    }
  }

  private shell(body: string, title: string, extra = ''): string {
    /*
     * Scripts are disabled outright and the content security policy allows only
     * inline styles. The preview renders somebody's document, and a document is
     * untrusted input: markdown-it runs with html:false so embedded HTML is
     * escaped rather than executed, and this is the second layer under that.
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
    padding: 24px 32px 64px;
    max-width: 62rem;
    margin: 0 auto;
  }
  h1, h2, h3, h4 { color: var(--vscode-foreground); line-height: 1.3; margin: 1.6em 0 .5em; }
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
    min-height: 60vh;
    text-align: center;
  }
  .status strong { display: block; color: var(--vscode-foreground); margin-bottom: .5em; }
  .note {
    color: var(--vscode-descriptionForeground);
    border-top: 1px solid var(--vscode-panel-border);
    margin-top: 3em;
    padding-top: 1em;
    font-size: .9em;
  }
  ${extra}
</style>
</head>
<body>${body}</body>
</html>`
  }

  private loadingHtml(title: string): string {
    return this.shell(`<div class="status"><div><strong>Reading ${escapeHtml(title)}…</strong>
      Converting on this machine. Nothing is uploaded.</div></div>`, title)
  }

  private renderedHtml(_webview: vscode.Webview, html: string, title: string): string {
    return this.shell(
      `${html}<p class="note">Read-only preview of <strong>${escapeHtml(title)}</strong>, converted to Markdown on this machine.
       Use <em>Convert to an editable Markdown file</em> in the title bar to save it.</p>`,
      title
    )
  }

  private errorHtml(message: string, title: string): string {
    return this.shell(
      `<div class="status"><div><strong>Could not read ${escapeHtml(title)}</strong>${escapeHtml(message)}</div></div>`,
      title
    )
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
