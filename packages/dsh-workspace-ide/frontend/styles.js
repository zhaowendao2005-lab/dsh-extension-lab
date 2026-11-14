/**
 * One style tag for the whole panel: the Host must never receive per-view style
 * churn, so every domain owns a CSS file and this module concatenates them once.
 */
import base from './styles/base.css';
import explorer from './styles/explorer.css';
import editor from './styles/editor.css';
import scm from './styles/scm.css';
import search from './styles/search.css';
import graph from './styles/graph.css';
import diff from './styles/diff.css';
import quickopen from './styles/quickopen.css';
import conflict from './styles/conflict.css';
import terminal from './styles/terminal.css';
import xtermCss from '@xterm/xterm/css/xterm.css';

export const CSS = [base, explorer, editor, scm, search, graph, diff, quickopen, conflict, terminal, xtermCss].join('\n');
