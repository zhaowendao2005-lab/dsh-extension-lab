/**
 * Markdown preview pane.
 *
 * Syntax handling is delegated wholesale to `react-markdown` + `remark-gfm` (GFM: tables,
 * task lists, strikethrough, autolinks) and `rehype-slug` (GitHub-compatible heading ids, so
 * `[jump](#deploy)` works — the same job as `#addNamedHeaders` in VS Code's markdown engine).
 * Nothing here parses Markdown, and nothing produces HTML: the tree is React elements, so a
 * README can never inject markup (docs/editor.md §12).
 *
 * Every element is created through `frontend/runtime.js`, i.e. with the Host's React copy.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { h, useEffect, useRef } from '../runtime.js';
import { classifyHref } from '../service/markdown-links.js';

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSlug];

/**
 * Render Markdown source into a React element tree.
 *
 * @param {string} text
 * @param {{ basePath?: string, openLink?: (path: string) => void,
 *           loadImage?: (path: string) => Promise<string | null> }} [options]
 *   `basePath` is the document itself, used to resolve relative links and images;
 *   `openLink` receives a workspace path for file targets; `loadImage` resolves a workspace
 *   path to a displayable URL (Blob URL) or null when the file cannot be shown.
 */
export function renderMarkdown(text, options = {}) {
  return h(ReactMarkdown, {
    remarkPlugins: REMARK_PLUGINS,
    rehypePlugins: REHYPE_PLUGINS,
    components: componentsFor(options),
    children: String(text ?? ''),
  });
}

function componentsFor({ basePath, openLink, loadImage } = {}) {
  return {
    a({ href, children }) {
      const target = classifyHref(href, basePath);
      if (target.kind === 'anchor') {
        return h('a', { className: 'wid-md__link', href: target.href, onClick: scrollToAnchor }, children);
      }
      if (target.kind === 'external') {
        return h(
          'a',
          { className: 'wid-md__link', href: target.href, target: '_blank', rel: 'noreferrer noopener' },
          children,
        );
      }
      if (target.kind === 'file' && typeof openLink === 'function') {
        return h(
          'a',
          {
            className: 'wid-md__link wid-md__link--file',
            href: '#',
            title: target.path,
            onClick: (event) => {
              event.preventDefault();
              openLink(target.path);
            },
          },
          children,
        );
      }
      // Unsupported or unresolvable target: keep the text, drop the navigation.
      return h('span', { className: 'wid-md__link wid-md__link--inert' }, children);
    },
    img({ src, alt, title }) {
      const target = classifyHref(src, basePath);
      if (target.kind === 'external') {
        return h('img', {
          className: 'wid-md__img',
          src: target.href,
          alt: alt ?? '',
          title,
          loading: 'lazy',
          decoding: 'async',
        });
      }
      if (target.kind !== 'file') return h('span', { className: 'wid-md__img-missing' }, alt || '图片');
      return h(MarkdownImage, { path: target.path, alt, title, loadImage });
    },
    table({ children }) {
      return h('div', { className: 'wid-md__table' }, h('table', null, children));
    },
  };
}

/**
 * Workspace image: the URL only exists after the binary is read, so it is attached once
 * `loadImage` settles. `loadImage` is the store's cached resolver, so re-renders reuse the
 * same Blob URL instead of re-reading the file.
 */
function MarkdownImage({ path, alt, title, loadImage }) {
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
  return h('img', { ref, className: 'wid-md__img', alt: alt ?? '', title: title ?? path, 'data-md-image': path });
}

/** In-pane anchor navigation: scroll the heading into view without touching the Host URL. */
function scrollToAnchor(event) {
  event.preventDefault();
  const id = String(event.currentTarget.getAttribute('href') ?? '').slice(1);
  const root = event.currentTarget.closest('.wid-md');
  if (!id || !root) return;
  const target = Array.from(root.querySelectorAll('[id]')).find((node) => node.id === id);
  if (target) target.scrollIntoView({ block: 'start' });
}
