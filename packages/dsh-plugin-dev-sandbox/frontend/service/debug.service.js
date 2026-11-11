/** Presentation rules for the debug tree. Pure functions: no React, no store. */

const GROUP_OF = [
  { id: 'tests', pattern: /test|spec/i },
  { id: 'checks', pattern: /check|lint|type|contrast|selector/i },
];

export function groupOf(commandId) {
  return GROUP_OF.find((group) => group.pattern.test(commandId))?.id ?? 'builds';
}

export const GROUP_LABELS = { runtime: '插件运行', builds: '构建', tests: '测试', checks: '检查' };

export function runtimeState(snapshot) {
  return snapshot?.runtime?.state || 'stopped';
}

export function runtimeLabel(state) {
  if (state === 'running') return '运行中';
  if (state === 'starting') return '启动中';
  if (state === 'exited') return '已退出';
  if (state === 'error') return '启动失败';
  return '已停止';
}

export function canLaunch(binding, snapshot, busy) {
  const state = runtimeState(snapshot);
  return Boolean(binding) && !busy && state !== 'running' && state !== 'starting';
}

export function canStop(snapshot) {
  return runtimeState(snapshot) === 'running'
    || snapshot?.command?.state === 'running'
    || (snapshot?.terminals ?? []).length > 0;
}

export function isScriptRunning(snapshot, commandId) {
  return snapshot?.command?.id === commandId && snapshot.command.state === 'running';
}

/** The tree mirrors the DOM: two fixed rows (launch/stop) plus one row per script group. */
export function debugGroups(snapshot) {
  const binding = snapshot?.binding;
  const commands = snapshot?.commands ?? [];
  const terminals = snapshot?.terminals ?? [];
  const state = runtimeState(snapshot);
  const runtime = {
    id: 'runtime',
    label: GROUP_LABELS.runtime,
    glyph: '▾',
    items: [
      { id: 'action:launch', label: '启动独立 DSH', glyph: '▶', action: 'launch', disabled: !binding || state === 'running' || state === 'starting' },
      { id: 'action:stop', label: '停止沙箱', glyph: '■', action: 'stop', disabled: !canStop(snapshot) },
    ],
  };
  const scripts = ['builds', 'tests', 'checks'].map((id) => ({
    id,
    label: GROUP_LABELS[id],
    glyph: '▾',
    items: commands.filter((command) => groupOf(command.id) === id).map((command) => ({
      id: `script:${command.id}`,
      label: command.id,
      commandId: command.id,
      glyph: id === 'tests' ? '✓' : id === 'checks' ? '◇' : '◆',
      disabled: !binding,
    })),
  }));
  if (terminals.length === 0 && commands.length === 0 && !binding) return [runtime, ...scripts];
  return [runtime, ...scripts];
}
