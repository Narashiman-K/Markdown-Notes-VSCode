# Changelog

## 1.0.0

First public release.

- **Document preview.** PDF, Word, Excel, PowerPoint, OpenDocument and EPUB
  files open in a read-only Markdown view instead of "binary file not shown".
  Nothing is written to disk.
- **A toolbar with words on it.** Across the top of every preview:
  **Save as .md**, a **View / Edit** pair, and **Open original**. No unlabelled
  icons to decipher.
- **Edit.** Opens the text in an ordinary editor tab as an untitled buffer that
  already carries the path it would be saved to, so <kbd>Ctrl</kbd>+<kbd>S</kbd>
  offers the right name beside the original. Change your mind and nothing is
  written. An already-converted file opens instead of a second copy.
- **Save as .md.** Also in the explorer right-click menu and the Command
  Palette. Writes `report.pdf.md`, keeping the full original name so
  `report.pdf` and `report.docx` cannot collide.
- **`#document` tool for chat.** Copilot agent mode can read any supported
  document directly, with no conversion step.
- **Preview cache for other agents.** Previewing also saves the Markdown to the
  extension's own storage, never beside your documents, and the toolbar prints
  the path — so an agent that can only read files can still be pointed at it.
  Switch off with `suprasuta.cachePreviewsForAgents`.

Conversion runs entirely on your machine. No upload, no account, no Pandoc and
no Python — which is the difference from every other converter extension.

`.md` files are deliberately untouched: VS Code's own Markdown preview stays the
default.

Works in Antigravity, Cursor and other VS Code forks, which is why it is
published to Open VSX as well as the Marketplace.

### Not yet

Images and audio. Text recognition needs an engine larger than this whole
extension and audio needs a paid account, so both are planned for 1.1 as an
opt-in, one-time download rather than dead weight for everyone. Both already
work in the [Windows app](https://apps.microsoft.com/detail/9N1S7QP2WNLX), the
web app and the
[MCP server](https://www.npmjs.com/package/suprasuta-markdown-mcp).
