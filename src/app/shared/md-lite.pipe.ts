import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Minimal, safe markdown-lite renderer for chat surfaces.
 * Escapes all HTML first, then applies: fenced code blocks, inline code,
 * bold, italic, links (http/https only), bullet lists, paragraphs.
 * No raw HTML passes through — XSS-safe by construction.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

export function renderMd(src: string): string {
  const blocks: string[] = [];
  let html = esc(src);
  // fenced code blocks first (placeholders protect contents)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push(`<pre class="md-code"><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `${blocks.length - 1}`;
  });
  const lines = html.split('\n');
  const out: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) {
      out.push(`<ul>${list.map((li) => `<li>${li}</li>`).join('')}</ul>`);
      list = [];
    }
  };
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };
  for (const ln of lines) {
    const ph = ln.match(/^(\d+)$/);
    if (ph) {
      flushList();
      flushPara();
      out.push(blocks[Number(ph[1])]);
    } else if (/^\s*[-*]\s+/.test(ln)) {
      flushPara();
      list.push(inline(ln.replace(/^\s*[-*]\s+/, '')));
    } else if (ln.trim() === '') {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(ln);
    }
  }
  flushList();
  flushPara();
  return out.join('');
}

@Pipe({ name: 'mdLite', standalone: true })
export class MdLitePipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);
  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';
    return this.sanitizer.bypassSecurityTrustHtml(renderMd(value));
  }
}
