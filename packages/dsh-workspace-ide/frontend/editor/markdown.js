/**
 * Markdown preview pane.
 *
 * Parses GFM via `react-markdown` + `remark-gfm`, allows safe inline/block HTML
 * (`<br>`, HTML tables with colspan/rowspan, `<details>`, `<sub>`, `<sup>`, `<kbd>`)
 * through `rehype-raw` + `rehype-sanitize`, adds GitHub-compatible heading slugs via
 * `rehype-slug`, renders leading YAML frontmatter as a metadata table (matching VS Code),
 * and highlights fenced code blocks using the bundled Lezer parsers.
 *
 * Output is strictly React elements created through `frontend/runtime.js` — never raw HTML
 * strings (check R16).
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import { Fragment, h, useEffect, useRef } from '../runtime.js';
import { classifyHref } from '../service/markdown-links.js';
import { highlightCodeSegments, normalizeCodeLanguage } from './markdown-highlight.js';
import {
  formatFrontmatterObject,
  formatFrontmatterScalar,
  parseFrontmatterYaml,
  splitFrontmatter,
} from './markdown-frontmatter.js';
import { Icon } from '../views/common/Icon.jsx';

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'u',
    'mark',
    'abbr',
    'caption',
    'colgroup',
    'col',
    'figure',
    'figcaption',
  ],
};

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], rehypeSlug];

const ALERT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|$)/i;
const ALERT_LABELS = {
  note: '注意',
  tip: '提示',
  important: '重要',
  warning: '警告',
  caution: '警示',
};

/**
 * Render Markdown source into a React element tree.
 *
 * @param {string} text
 * @param {{ basePath?: string, openLink?: (path: string) => void,
 *           loadImage?: (path: string) => Promise<string | null> }} [options]
 */
export function renderMarkdown(text, options = {}) {
  const source = String(text ?? '');
  const split = splitFrontmatter(source);
  const body = split ? split.body : source;
  const frontmatter = split ? parseFrontmatterYaml(split.source) : null;

  return h(
    Fragment,
    null,
    frontmatter ? h(FrontmatterView, { parsed: frontmatter }) : null,
    h(ReactMarkdown, {
      remarkPlugins: REMARK_PLUGINS,
      rehypePlugins: REHYPE_PLUGINS,
      components: componentsFor(options),
      children: body,
    }),
  );
}

function FrontmatterView({ parsed }) {
  if (parsed.error) {
    return h(
      'div',
      { className: 'wid-md__frontmatter-error', role: 'alert' },
      h('strong', null, 'Frontmatter 解析失败'),
      h('pre', null, parsed.error),
    );
  }
  if (!parsed.entries.length) return null;

  return h(
    'div',
    { className: 'wid-md__table wid-md__frontmatter', title: 'Frontmatter' },
    h(
      'table',
      { className: 'wid-md__frontmatter-table' },
      h(
        'tbody',
        null,
        parsed.entries.map(([key, value], index) =>
          h(
            'tr',
            { key: index + ':' + key },
            h('th', null, key || '—'),
            h('td', null, renderFrontmatterValue(value)),
          )),
      ),
    ),
  );
}

function renderFrontmatterValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    if (!value.length) return '';
    return h(
      'ul',
      null,
      value.map((item, idx) => h('li', { key: idx }, renderFrontmatterValue(item))),
    );
  }
  if (typeof value === 'object') {
    return h('code', null, formatFrontmatterObject(value));
  }
  return formatFrontmatterScalar(value);
}

function componentsFor({ basePath, openLink, loadImage } = {}) {
  return {
    a({ href, title, children }) {
      const target = classifyHref(href, basePath);
      if (target.kind === 'anchor') {
        return h('a', { className: 'wid-md__link', href: target.href, title, onClick: scrollToAnchor }, children);
      }
      if (target.kind === 'external') {
        return h(
          'a',
          { className: 'wid-md__link', href: target.href, title, target: '_blank', rel: 'noreferrer noopener' },
          children,
        );
      }
      if (target.kind === 'file' && typeof openLink === 'function') {
        return h(
          'a',
          {
            className: 'wid-md__link wid-md__link--file',
            href: '#',
            title: title || target.path,
            onClick: (event) => {
              event.preventDefault();
              openLink(target.path);
            },
          },
          children,
        );
      }
      return h('span', { className: 'wid-md__link wid-md__link--inert', title }, children);
    },
    img({ src, alt, title, width, height, align }) {
      const target = classifyHref(src, basePath);
      const dims = pickImageDimensions({ width, height, align });
      if (target.kind === 'external') {
        return h('img', {
          className: 'wid-md__img',
          src: target.href,
          alt: alt ?? '',
          title,
          loading: 'lazy',
          decoding: 'async',
          ...dims,
        });
      }
      if (target.kind !== 'file') return h('span', { className: 'wid-md__img-missing' }, alt || '图片');
      return h(MarkdownImage, { path: target.path, alt, title, loadImage, dims });
    },
    table({ children }) {
      return h('div', { className: 'wid-md__table' }, h('table', null, children));
    },
    blockquote({ children }) {
      const alert = parseAlertBlockquote(children);
      if (alert) {
        return h(
          'div',
          { className: 'wid-md__alert wid-md__alert--' + alert.kind },
          h('div', { className: 'wid-md__alert-title' }, ALERT_LABELS[alert.kind]),
          alert.children,
        );
      }
      return h('blockquote', null, children);
    },
    pre({ node, children }) {
      const codeNode = findDirectCodeElement(node);
      if (codeNode) {
        const lang = extractCodeLanguage(codeNode);
        const plainOnly = hasOnlyTextChildren(codeNode);
        const rawText = extractHastText(codeNode).replace(/\n$/, '');
        const segments = plainOnly ? highlightCodeSegments(rawText, lang) : null;
        return h(CodeBlock, { lang, rawText, segments, fallbackChildren: children });
      }
      const rawText = extractHastText(node).replace(/\n$/, '');
      return h(CodeBlock, { lang: '', rawText, segments: null, fallbackChildren: children, rawPre: true });
    },
  };
}

function pickImageDimensions({ width, height, align }) {
  const out = {};
  if (width !== undefined && /^\d+(?:px|%)?$/.test(String(width).trim())) out.width = width;
  if (height !== undefined && /^\d+(?:px|%)?$/.test(String(height).trim())) out.height = height;
  if (align === 'left' || align === 'right' || align === 'center' || align === 'middle') out.align = align;
  return out;
}

function CodeBlock({ lang, rawText, segments, fallbackChildren, rawPre = false }) {
  const preRef = useRef(null);
  const label = normalizeCodeLanguage(lang);
  const hasHeader = Boolean(label);
  const codeBody = rawPre
    ? fallbackChildren
    : segments
      ? h(
        'code',
        { className: label ? 'language-' + label : undefined },
        segments.map((seg, idx) =>
          (seg.className
            ? h('span', { key: idx, className: seg.className }, seg.text)
            : seg.text)),
      )
      : fallbackChildren;

  return h(
    'div',
    { className: 'wid-md__codeblock', 'data-has-header': hasHeader ? 'true' : 'false' },
    hasHeader
      ? h(
        'div',
        { className: 'wid-md__codehead' },
        h('span', { className: 'wid-md__code-lang' }, label),
        h(CopyCodeButton, { text: rawText, preRef, floating: false }),
      )
      : h(CopyCodeButton, { text: rawText, preRef, floating: true }),
    h('pre', { ref: preRef, className: 'wid-md__pre' }, codeBody),
  );
}

function CopyCodeButton({ text, preRef, floating }) {
  const btnRef = useRef(null);
  const timerRef = useRef(0);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  async function onCopy(event) {
    event.preventDefault();
    event.stopPropagation();
    let copied = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied && preRef.current && typeof window !== 'undefined') {
      try {
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(preRef.current);
          selection.addRange(range);
          copied = document.execCommand('copy');
          selection.removeAllRanges();
        }
      } catch {
        copied = false;
      }
    }
    if (!copied || !btnRef.current) return;
    btnRef.current.dataset.copied = 'true';
    btnRef.current.title = '已复制';
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = 0;
      if (btnRef.current) {
        delete btnRef.current.dataset.copied;
        btnRef.current.title = '复制代码';
      }
    }, 1800);
  }

  return h(
    'button',
    {
      ref: btnRef,
      type: 'button',
      className: floating ? 'wid-md__copy wid-md__copy--floating' : 'wid-md__copy',
      title: '复制代码',
      'aria-label': '复制代码',
      onClick: onCopy,
    },
    h('span', { className: 'wid-md__copy-default' }, h(Icon, { name: 'copy', size: 13 })),
    h('span', { className: 'wid-md__copy-done' }, h(Icon, { name: 'check', size: 13 })),
  );
}

function findDirectCodeElement(preNode) {
  const list = preNode?.children;
  if (!Array.isArray(list)) return null;
  for (const child of list) {
    if (child?.type === 'element' && child.tagName === 'code') return child;
  }
  return null;
}

function extractCodeLanguage(codeNode) {
  const cls = codeNode?.properties?.className;
  const list = Array.isArray(cls) ? cls : (typeof cls === 'string' ? cls.split(/\s+/) : []);
  for (const token of list) {
    if (typeof token === 'string' && token.startsWith('language-')) {
      return token.slice('language-'.length);
    }
  }
  return '';
}

function hasOnlyTextChildren(node) {
  return Array.isArray(node?.children) && node.children.every((child) => child?.type === 'text');
}

function extractHastText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  if (!Array.isArray(node.children)) return '';
  return node.children.map(extractHastText).join('');
}

function parseAlertBlockquote(children) {
  const list = Array.isArray(children) ? children : [children];
  const firstIdx = list.findIndex((child) => !(typeof child === 'string' && !child.trim()));
  if (firstIdx === -1) return null;
  const first = list[firstIdx];
  if (!first || typeof first !== 'object' || first.type !== 'p') return null;

  const pKids = Array.isArray(first.props?.children)
    ? first.props.children
    : (first.props?.children != null ? [first.props.children] : []);
  if (typeof pKids[0] !== 'string') return null;

  const match = ALERT_RE.exec(pKids[0]);
  if (!match) return null;

  const kind = match[1].toLowerCase();
  const remainder = pKids[0].slice(match[0].length);
  const nextPKids = [];
  if (remainder) nextPKids.push(remainder);
  let skipIdx = 1;
  if (!remainder && pKids[1] && typeof pKids[1] === 'object' && pKids[1].type === 'br') {
    skipIdx = 2;
  }
  for (let i = skipIdx; i < pKids.length; i += 1) nextPKids.push(pKids[i]);

  const rest = list.slice(firstIdx + 1);
  const nextChildren = [];
  if (nextPKids.length) {
    nextChildren.push(h('p', { key: first.key ?? 'alert-lead' }, nextPKids));
  }
  nextChildren.push(...rest);
  return { kind, children: nextChildren };
}

/**
 * Workspace image: the URL only exists after the binary is read, so it is attached once
 * `loadImage` settles. `loadImage` is the store's cached resolver, so re-renders reuse the
 * same Blob URL instead of re-reading the file.
 */
function MarkdownImage({ path, alt, title, loadImage, dims }) {
  const ref = useRef(null);
  useEffect(() => {
    if (typeof loadImage !== 'function') return undefined;
    let alive = true;
    Promise.resolve()
      .then(() => loadImage(path))
      .then((url) => {
        if (alive && url && ref.current) ref.current.src = url;
      })
      .catch(() => {
        // A failed image keeps the alt text; it must not break the rest of the preview.
      });
    return () => {
      alive = false;
    };
  }, [path, loadImage]);
  return h('img', {
    ref,
    className: 'wid-md__img',
    alt: alt ?? '',
    title: title ?? path,
    'data-md-image': path,
    ...(dims ?? {}),
  });
}

/** In-pane anchor navigation: scroll the heading into view without touching the Host URL. */
function scrollToAnchor(event) {
  event.preventDefault();
  const raw = String(event.currentTarget.getAttribute('href') ?? '').slice(1);
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }
  const root = event.currentTarget.closest('.wid-md');
  if (!id || !root) return;
  const nodes = Array.from(root.querySelectorAll('[id]'));
  const lower = id.toLowerCase();
  const target =
    nodes.find((node) => node.id === id || node.id === 'user-content-' + id)
    ?? nodes.find((node) => node.id.toLowerCase() === lower || node.id.toLowerCase() === 'user-content-' + lower);
  if (target) target.scrollIntoView({ block: 'start' });
}
