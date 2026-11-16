/**
 * Mermaid diagrams in VS Code's own Markdown preview.
 *
 * Contributed through `markdown.previewScripts`, so it runs inside the
 * built-in preview: every ```` ```mermaid ```` block is drawn as a diagram,
 * and redrawn when the preview updates. Mermaid runs with
 * `securityLevel: 'strict'` (no clicks, no scripts in labels). A block that
 * cannot be drawn keeps its code, with the reason underneath.
 *
 * Bundled into media/mermaid-preview.js by scripts/build.mjs.
 */
import mermaid from 'mermaid'

let theme = ''
let seq = 0

function wanted(): 'dark' | 'default' {
  const c = document.body.classList
  return c.contains('vscode-dark') || c.contains('vscode-high-contrast') ? 'dark' : 'default'
}

async function draw(): Promise<void> {
  const t = wanted()
  if (t !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: t, fontFamily: 'var(--vscode-font-family, sans-serif)' })
    theme = t
  }
  const blocks = document.querySelectorAll<HTMLElement>('pre > code.language-mermaid, div.mermaid:not([data-drawn])')
  for (const code of blocks) {
    const host = code.tagName === 'CODE' ? (code.parentElement as HTMLElement) : code
    if (host.dataset.drawn) continue
    const src = code.textContent ?? ''
    if (!src.trim()) continue
    host.dataset.drawn = '1'
    try {
      const { svg } = await mermaid.render(`suprasuta-mermaid-${++seq}`, src)
      const fig = document.createElement('div')
      fig.className = 'suprasuta-mermaid'
      fig.style.cssText = 'display:flex;justify-content:center;overflow-x:auto;margin:1em 0'
      fig.innerHTML = svg
      fig.dataset.drawn = '1'
      host.replaceWith(fig)
    } catch (e) {
      document.getElementById(`dsuprasuta-mermaid-${seq}`)?.remove()
      const note = document.createElement('div')
      note.style.cssText = 'font-size:0.85em;opacity:0.75;margin:-0.6em 0 1em'
      note.textContent = `Mermaid: ${(e as Error)?.message ?? e}`.split('\n')[0].slice(0, 200)
      host.after(note)
    }
  }
}

let queued = false
function schedule(): void {
  if (queued) return
  queued = true
  setTimeout(() => {
    queued = false
    void draw()
  }, 50)
}

window.addEventListener('vscode.markdown.updateContent', schedule)
new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] })
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule)
else schedule()
