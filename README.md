<div align="center">

# Suprasūtā Markdown Notes

**Open PDF, Word, Excel, PowerPoint, OpenDocument and EPUB files in VS Code.**

Converted on your own machine. No upload, no account, no Pandoc, no Python.

</div>

---

## The problem

Open a PDF in VS Code and you get *"The file is not displayed in the editor
because it is either binary or uses an unsupported text encoding."* Open a
`.docx` and you get the same. Yet these are the files people are asked to read,
summarise and quote from all day.

The existing ways around it either shell out to Pandoc — which the user has to
install separately — or upload the document to a service.

## What this does

**Opening one of these files shows you its contents**, rendered as Markdown in a
read-only tab. Nothing is written to disk, and nothing leaves your machine.

| | |
| --- | --- |
| **Preview** | `.pdf` `.docx` `.xlsx` `.xlsm` `.xls` `.pptx` `.odt` `.ods` `.epub` |
| **Convert** | All of the above, plus `.csv` and `.tsv` |

A toolbar across the top of the preview gives you three things:

| | |
| --- | --- |
| **Save as .md** | Writes `report.pdf.md` beside the original. The full original name is kept, so a folder containing `report.pdf`, `report.docx` and `report.epub` gives three distinct files rather than a guessing game. |
| **View / Edit** | Edit opens the text in an ordinary editor tab. Nothing is written until you press <kbd>Ctrl</kbd>+<kbd>S</kbd>, which offers to save it beside the original with the name already filled in. If a converted file is already there, that one opens instead. |
| **Open original** | Hands the file to Word, Excel, or whatever owns it. |

**Convert to Markdown** is also in the explorer right-click menu, for converting
without opening anything.

Tables come through as real Markdown tables, headings are preserved, and code
blocks are fenced properly.

## Chat and agents

The extension contributes a **`#document` tool**, so Copilot's agent mode can
read documents on its own:

> Summarise `#document` contracts/lease.pdf and list the renewal dates

No conversion step, no temp file, nothing written.

For agents that can only read files, previewing a document also saves its
Markdown to the extension's storage folder. That is off with
`suprasuta.cachePreviewsForAgents` if you would rather it did not. Nothing is
ever written beside your own documents unless you ask for a conversion.

## What it does not do

**It does not touch `.md` files.** VS Code's built-in Markdown preview is good
and already familiar; replacing it uninvited would be presumptuous.

**No images or audio, yet.** Optical character recognition needs an engine far
larger than this whole extension, and audio transcription needs a paid account.
Both are planned for 1.1 as an opt-in download. Both work today in the
[desktop app](https://apps.microsoft.com/detail/9N1S7QP2WNLX) and the
[MCP server](https://www.npmjs.com/package/suprasuta-markdown-mcp).

## Settings

| Setting | Default | |
| --- | --- | --- |
| `suprasuta.convertedFileLocation` | `besideOriginal` | Or `askEachTime` for a save dialog |
| `suprasuta.openAfterConverting` | `true` | Open the `.md` once it is written |
| `suprasuta.cachePreviewsForAgents` | `true` | Save previews to extension storage for chat agents |

## Privacy

Documents are read and converted in the extension host on your machine. There
is no account, no analytics, no telemetry, and no server. See
[PRIVACY.md](PRIVACY.md).

## Antigravity and other VS Code forks

Antigravity is built on VS Code, so this extension works there too. Forks cannot
use the Microsoft marketplace, so it is published to
[Open VSX](https://open-vsx.org) as well.

## Building it yourself

```bash
npm install          # .npmrc sets include=dev — do not delete it
npm run build
npm run verify       # converts the sample files and compares against the canonical output
npm run package      # produces build/*.vsix
```

`npm run verify` is worth knowing about. The converters in `src/lib/convert/`
are kept byte-identical to the copies in the Windows, web, Android and MCP
projects, and that script proves a change here has not quietly altered what a
document turns into.

> One finding preserved from the attempt to make this dependency-free: jsdom can
> be replaced with domino for HTML and xmldom for XML, and every format still
> converts identically **except EPUB**, which fails because `office.ts` uses
> `querySelector` and xmldom implements no Selectors API. Worth revisiting only
> with a parser that handles both namespaced XML and selectors.

## Related

| | |
| --- | --- |
| Windows app | [Microsoft Store](https://apps.microsoft.com/detail/9N1S7QP2WNLX) |
| Web app | [markdown-notes-psi.vercel.app](https://markdown-notes-psi.vercel.app) |
| MCP server | [npm](https://www.npmjs.com/package/suprasuta-markdown-mcp) · for Claude, VS Code and Antigravity agents |

Created by **[Narashiman Krishnamurthy](https://github.com/Narashiman-K)**.
Free for personal, non-commercial use — see [LICENSE.md](LICENSE.md).
