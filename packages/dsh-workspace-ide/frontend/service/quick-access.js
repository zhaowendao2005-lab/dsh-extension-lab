import { scorePath } from './fuzzy.js';

/** Explicit aliases support English word/camel initials and Chinese pinyin initials. */
export const QUICK_COMMANDS = [
  { id: 'repositories', label: '打开仓库视图', detail: '选择要跟踪的 Git 仓库', icon: 'branch', aliases: ['repositories', 'open repositories', 'ck', 'dkck'] },
  { id: 'commands', label: '打开命令脚本视图', detail: '查看 package.json Scripts', icon: 'terminal', aliases: ['commands', 'package scripts', 'run scripts', 'ml', 'jb', 'dkml'] },
  { id: 'quickOpen', label: '快速查找文件', detail: '按文件名或路径模糊匹配', icon: 'search', aliases: ['quick open', 'files', 'file search', 'ksdk', 'wj', 'ksczwj'] },
  { id: 'search', label: '搜索文件内容', detail: '在此面板进行全文搜索', icon: 'search', aliases: ['search', 'content search', 'full text', 'ss', 'q w s s', 'qwss', 'sswjnr'] },
  { id: 'changes', label: '打开源代码管理', detail: '查看工作区变更', icon: 'branch', aliases: ['changes', 'source control', 'scm', 'bg', 'ydmgl'] },
  { id: 'graph', label: '打开提交图谱', detail: '查看 Git 提交历史', icon: 'graph', aliases: ['graph', 'git history', 'commit graph', 'tp', 'tjtp'] },
  { id: 'terminal', label: '切换终端面板', detail: '显示或隐藏终端', icon: 'terminal', aliases: ['terminal', 'toggle terminal', 'zd', 'qhzd'] },
  { id: 'fullView', label: '切换全视图', detail: '展开或收起全视图', icon: 'expand', aliases: ['full view', 'toggle full view', 'fullscreen', 'qst', 'qhqst'] },
  { id: 'navigation', label: '切换文件导航栏', detail: '展开或收起文件栏', icon: 'explorer', aliases: ['navigation', 'toggle sidebar', 'explorer', 'dh', 'wjdh', 'qhwjdh'] },
  { id: 'refresh', label: '刷新工作区', detail: '重新读取工作区状态', icon: 'refresh', aliases: ['refresh', 'reload workspace', 'sx', 'sxgzq'] },
];

export const FILE_EXCLUDES = ['**/.git/**', '**/.svn/**', '**/.hg/**', '**/.DS_Store', '**/Thumbs.db'];
export const SEARCH_EXCLUDES = ['**/node_modules/**', '**/bower_components/**', '**/.cache/**', '**/coverage/**'];

export function quickMode(query, mode = 'files') {
  return String(query).trimStart().startsWith('/') ? 'commands' : mode === 'content' ? 'content' : 'files';
}

export function rankCommands(query, recent = [], enabled = () => true) {
  const needle = String(query).trimStart().replace(/^\//, '').trim().toLowerCase().replace(/\s+/g, '');
  const order = new Map(recent.map((id, index) => [id, index]));
  return QUICK_COMMANDS.map((command, index) => {
    const score = needle ? Math.max(...[command.label, command.id, ...command.aliases].map((text) => scorePath(text.replace(/\s+/g, ''), needle))) : 0;
    const capability = enabled(command.id);
    return { ...command, kind: 'command', score, index, recent: order.has(command.id), recentIndex: order.get(command.id) ?? Infinity,
      disabled: capability === false || typeof capability === 'string', reason: typeof capability === 'string' ? capability : capability === false ? '当前不可用' : null };
  }).filter((command) => command.score >= 0).sort((a, b) => Number(b.recent) - Number(a.recent) || (a.recent ? a.recentIndex - b.recentIndex : b.score - a.score) || a.index - b.index)
    .map((command) => ({ ...command, group: command.recent ? '最近使用' : '其他命令' }));
}

export function rememberCommand(recent, id, limit = 50) {
  return [id, ...recent.filter((item) => item !== id)].filter((item) => QUICK_COMMANDS.some((command) => command.id === item)).slice(0, limit);
}

export function matchPieces(text, query) {
  const source = String(text);
  const needle = String(query).trim().toLowerCase().replace(/\s+/g, '');
  const marks = new Set();
  let at = -1;
  for (const char of needle) {
    at = source.toLowerCase().indexOf(char, at + 1);
    if (at < 0) return [{ text: source, marked: false }];
    marks.add(at);
  }
  const pieces = [];
  for (let index = 0; index < source.length; index += 1) {
    const marked = marks.has(index);
    if (pieces.length && pieces[pieces.length - 1].marked === marked) pieces[pieces.length - 1].text += source[index];
    else pieces.push({ text: source[index], marked });
  }
  return pieces;
}
