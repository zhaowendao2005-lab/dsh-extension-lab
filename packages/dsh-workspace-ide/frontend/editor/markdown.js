/**
 * Minimal Markdown renderer for the preview pane. It deliberately stays dependency-free:
 * the panel ships as a single IIFE bundle and a full CommonMark parse is not worth 30 kB gzip
 * for "read the README" (docs/editor.md §7 → Markdown 预览).
 *
 * Supported: ATX headings, fenced code, block quotes, ordered/unordered lists, horizontal
 * rules, paragraphs, and inline code/bold/italic/strikethrough/links. Everything renders as
 * React elements — never `dangerouslySetInnerHTML`, so a README cannot inject markup.
 */
import { h, Fragment } from '../runtime.js';

const FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

const INLINE = [
  { re: /`([^`]+)`/g, wrap: (children, key) => h('code', { key, className: 'wid-md__code' }, children) },
  { re: /\*\*([^*]+)\*\*/g, wrap: (children, key) => h('strong', { key }, children) },
  { re: /(?<![*])\*([^*]+)\*(?!\*)/g, wrap: (children, key) => h('em', { key }, children) },
  { re: /~~([^~]+)~~/g, wrap: (children, key) => h('del', { key }, children) },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/g,
    wrap: (children, key, match) =>
      h('a', { key, href: safeHref(match[2]), target: '_blank', rel: 'noreferrer noopener' }, children),
  },
];

function safeHref(href) {
  const value = String(href ?? '').trim();
  return /^(https?:|mailto:|#|\/|\.)/i.test(value) ? value : '#';
}

/** Expand `**bold with `code` inside**`-style nesting one level deep. */
function inline(text, keyPrefix = 'i') {
  let nodes = [text];
  for (const rule of INLINE) {
    const next = [];
    for (const node of nodes) {
      if (typeof node !== 'string') {
        next.push(node);
        continue;
      }
      let last = 0;
      let match;
      rule.re.lastIndex = 0;
      let index = 0;
      while ((match = rule.re.exec(node))) {
        if (match.index > last) next.push(node.slice(last, match.index));
        const inner = match[1] ?? '';
        const key = `${keyPrefix}-${rule.re.source.slice(0, 3)}-${index}`;
        index += 1;
        next.push(rule.wrap(inner, key, match));
        last = match.index + match[0].length;
      }
      if (last < node.length) next.push(node.slice(last));
    }
    nodes = next;
  }
  return nodes;
}

export function renderMarkdown(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let index = 0;
  let key = 0;

  const nextKey = (prefix) => `${prefix}-${(key += 1)}`;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const language = fence[2] ?? '';
      const body = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(marker)) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        h(
          'pre',
          { key: nextKey('pre'), className: 'wid-md__pre' },
          h('code', { className: 'wid-md__code', 'data-language': language || undefined }, body.join('\n')),
        ),
      );
      continue;
    }

    if (RULE.test(line)) {
      blocks.push(h('hr', { key: nextKey('hr') }));
      index += 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      blocks.push(h(`h${level}`, { key: nextKey('h'), className: `wid-md__h wid-md__h${level}` }, inline(heading[2], nextKey('hi'))));
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        body.push(lines[index].match(QUOTE)[1]);
        index += 1;
      }
      blocks.push(h('blockquote', { key: nextKey('bq'), className: 'wid-md__quote' }, renderMarkdown(body.join('\n'))));
      continue;
    }

    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line);
      const pattern = ordered ? OL : UL;
      const items = [];
      while (index < lines.length && pattern.test(lines[index])) {
        const match = lines[index].match(pattern);
        const itemText = ordered ? match[2] : match[1];
        // An indented continuation line belongs to the same item.
        let rest = itemText;
        index += 1;
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !pattern.test(lines[index])) {
          rest += ` ${lines[index].trim()}`;
          index += 1;
        }
        items.push(h('li', { key: nextKey('li') }, inline(rest, nextKey('lii'))));
      }
      blocks.push(h(ordered ? 'ol' : 'ul', { key: nextKey('list'), className: 'wid-md__list' }, items));
      continue;
    }

    // Paragraph: consume until a blank line or a block opener.
    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const candidate = lines[index];
      if (!candidate.trim() || FENCE.test(candidate) || HEADING.test(candidate) || RULE.test(candidate)) break;
      if (UL.test(candidate) || OL.test(candidate) || QUOTE.test(candidate)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push(h('p', { key: nextKey('p'), className: 'wid-md__p' }, inline(paragraph.join(' '), nextKey('pi'))));
  }

  return h(Fragment, null, blocks);
}
