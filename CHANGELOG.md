# Changelog

## 0.1.0

First release.

- **Document preview.** PDF, Word, Excel, PowerPoint, OpenDocument and EPUB
  files open in a read-only Markdown view instead of "binary file not shown".
  Nothing is written to disk.
- **Convert to Markdown.** From the explorer right-click menu, the preview's
  title bar, or the Command Palette. Saves `report.pdf.md` beside the original,
  keeping the full original name so same-named documents cannot collide.
- **`#document` tool for chat.** Copilot agent mode can read any supported
  document directly, with no conversion step.
- **Preview cache for other agents.** Previewing also saves the Markdown to the
  extension's own storage, never beside your documents. Switch off with
  `suprasuta.cachePreviewsForAgents`.

Conversion runs entirely on your machine. No upload, no account, no Pandoc and
no Python — which is the difference from every other converter extension.

`.md` files are deliberately untouched: VS Code's own Markdown preview stays the
default.

### Not yet

Images and audio. Text recognition needs an engine larger than this whole
extension and audio needs a paid account, so both are planned for 1.1 as an
opt-in, one-time download rather than dead weight for everyone.
