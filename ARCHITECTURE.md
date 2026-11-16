# Architecture — Suprasūtā Markdown Notes (VS Code / Antigravity)

An extension that opens PDF, Word, Excel, PowerPoint, OpenDocument and EPUB
files directly inside the editor as readable Markdown, and exposes the same
conversion to the IDE's AI agent as a language-model tool.

This document is for someone who has cloned the repository and wants to find
their way around without breaking an invariant they could not have guessed at.

---

## 1. At a glance

| | |
|---|---|
| Host API | VS Code extension API, `engines.vscode ^1.95.0` |
| Bundler | esbuild |
| Activation | `onLanguage:markdown` |
| Packaging | `@vscode/vsce` → `.vsix` |
| Native modules | **none** |

It runs unchanged in **VS Code, Antigravity and Cursor** — all three are VS Code
forks that implement the same extension API surface this uses.

---

## 2. Layout

```
src/
  extension.ts      activation, commands, registration
  preview.ts        the custom read-only editor (webview)
  convert.ts        bridges commands to the converters
  agent.ts          languageModelTools — the AI-facing surface
  paste.ts          DocumentPasteEditProvider — smart paste
  decorations.ts    block tints in the Markdown editor
  sync.ts           scroll synchronisation
  verify.ts         parser sanity check
  runtime/node.ts   browser globals for the extension host
  lib/convert/      converters (copy of the canonical set)
  shared/formats.ts the format list, identical in all four repositories
scripts/
  build.mjs         esbuild
  package-vsix.mjs  vsix packaging
  verify-parsers.mjs
```

---

## 3. The custom editor

`src/preview.ts` registers a `CustomReadonlyEditorProvider` for the viewType
`suprasuta.documentPreview`, against `*.pdf`, `*.docx`, `*.xlsx`, `*.pptx` and
the rest. It is contributed with `priority: "default"`, so double-clicking one
of those files in the explorer opens the Markdown view rather than the binary.

Commands sit alongside it for the cases where that is not what you wanted:

| Command | Title |
|---|---|
| `suprasuta.convertToMarkdown` | Convert to Markdown |
| `suprasuta.convertFromPreview` | Save as a Markdown file |
| `suprasuta.editAsMarkdown` | Edit as Markdown |
| `suprasuta.openInDefaultApp` | Open in its own application |

"Edit as Markdown" opens the converted text in the editor's **own** Markdown
editor — this extension does not ship an editor of its own, which is the main
way it differs from the desktop and web apps.

### Webview security

```ts
panel.webview.options = { enableScripts: true, enableCommandUris: [...ALLOWED_COMMANDS] }
webviewOptions: { retainContextWhenHidden: true }
```

```
default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}';
```

One script, admitted by a nonce regenerated on every render, and nothing else:
no inline handlers, no external anything, no eval. `enableCommandUris` is an
allowlist rather than `true`, so a document cannot invoke arbitrary commands by
embedding a link.

If you ever see *"Could not register service worker"* when a webview loads,
that is VS Code's own service-worker cache, not this extension. Renaming
`%APPDATA%\Code\Service Worker` clears it.

---

## 4. The agent surface

`src/agent.ts` contributes `languageModelTools`, which is what lets the AI agent
in VS Code, Antigravity or Cursor read a user's documents:

- `suprasuta_convert_document` — read a PDF, Word, Excel, PowerPoint,
  OpenDocument or EPUB file from the machine and return it as Markdown.

This is the same capability the MCP server offers Claude Desktop, reached
through a different protocol. The converters underneath are the same files.

---

## 5. Editing niceties in Markdown files

Three features attach to the editor's own Markdown documents rather than to the
preview:

- **`paste.ts`** — a `DocumentPasteEditProvider` offering a formatted paste
  from Word, Excel or a browser via the same `htmlToMarkdown` the converters
  use, so a pasted table and a converted one produce the same dialect.
- **`decorations.ts`** — background tints marking where each block starts and
  ends. Converted documents produce long stretches with no visual structure, and
  syntax highlighting colours the *markers*, which is no help when the markers
  are off screen. Colours are contributed as themeable IDs
  (`suprasuta.codeBlockBackground` and siblings) so they follow the user's theme
  including high contrast.
- **`sync.ts`** — scroll synchronisation between source and preview.

---

## 6. Converters under the extension host

`src/lib/convert/` is a copy of the canonical converters from
`Markdown-Notes-MCP`. They are browser-shaped and pure — bytes in, Markdown out
— and they run here under Node because two things bridge the gap:

- **`lib/convert/runtime.ts`**, the host seam. The converters ask the host the
  three questions that differ between environments — where Tesseract's worker,
  WASM core and language data live; how to hand a `.docx` to mammoth; what this
  environment's Tesseract accepts as an image — rather than sniffing for
  `process`. Defaults are the browser behaviour.
- **`src/runtime/node.ts`**, which supplies the browser globals the converters
  still touch. This is safe alongside a plain static import because no converter
  touches a browser global at module scope; every use is inside a function.

This build uses `@mixmark-io/domino` and `@xmldom/xmldom` rather than jsdom for
DOM work where it can, because the extension host is a long-lived shared process
and the lighter parsers cost less to load.

**OCR is not wired up here yet.** `ocr.ts` currently has three distinct variants
across the family, and this repository's copy is the one without a working image
path. It is the main outstanding piece of drift.

---

## 7. This repository's place in the family

| Repository | What it is |
|---|---|
| **Markdown-Notes-VSCode** (this one) | VS Code / Antigravity / Cursor extension |
| Markdown-Notes-MCP | MCP server — **canonical converters** |
| Markdown-Notes-windows | Electron desktop app, Microsoft Store |
| Markdown-Notes-web | Browser app, PWA |

The converters exist in four copies by deliberate choice. A shared npm package
would remove drift by construction — and would also tie four independent release
cadences together, so a converter fix could not reach this extension without a
publish cycle elsewhere.

The judgement was that independent release cadences are worth more than enforced
sameness, **provided drift is visible**. `Markdown-Notes-MCP` carries
`scripts/sync-converters.mjs` for that. Its copy is canonical: it is the only
one with the runtime hook, so improvements start there and flow outward. This
repository keeps its own copy and its own check.

`src/shared/formats.ts` is byte-identical in all four.

---

## 8. Build and package

```
npm run build        esbuild → out/
npm run watch        esbuild, watching
npm run typecheck    tsc --noEmit
npm run verify       parser sanity check
npm run package      production build → .vsix
```

**No native modules.** Everything is pure JavaScript or WASM, which is what
lets a single `.vsix` install into VS Code, Antigravity and Cursor on any
platform without a build step.

---

## 9. Conventions worth knowing

- **Keep `lib/convert/` pure.** No network calls, no `process` checks, no
  browser globals at module scope. Anything the host must answer goes through
  `ConvertRuntime`.
- **The CSP nonce regenerates per render.** Do not cache generated HTML across
  renders; the nonce will not match and the script will be refused.
- **`enableCommandUris` is an allowlist.** Adding a command URI to the preview
  means adding it to `ALLOWED_COMMANDS`, deliberately.
- **Never paste an access token into a chat, an issue, or a commit.** Publishing
  to the Marketplace and Open VSX is done by the maintainer with their own
  credentials.

---

## 10. Where this is going

Outstanding: image and audio OCR, which needs this repository's `ocr.ts` brought
back in line with the canonical copy; and publication to the VS Code Marketplace
and Open VSX, which requires the Eclipse Publisher Agreement.
