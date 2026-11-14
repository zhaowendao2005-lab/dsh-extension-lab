/**
 * Source Control domain: every git write goes through one serial queue, because git takes
 * the index lock and two concurrent writers produce `index.lock` failures that look like
 * random errors to the user (docs/git-model.md §写队列).
 */
import { IdeError, isTrustError } from '../service/client.js';

export function createScmDomain({ client, scm, workspace, notify, fail, confirm, prompt, refreshScm, openFile }) {
  let queue = Promise.resolve();
  let depth = 0;

  function enqueue(label, operation) {
    depth += 1;
    scm.patch({ writes: [...scm.getSnapshot().writes, label] });
    const run = queue.then(async () => {
      try {
        return await operation();
      } finally {
        depth -= 1;
        scm.set((state) => ({ ...state, writes: state.writes.filter((item) => item !== label) }));
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  async function write(label, action, payload) {
    if (!workspace.getSnapshot().root) return null;
    try {
      const result = await enqueue(label, () => client.call(action, payload));
      await refreshScm();
      return result;
    } catch (error) {
      if (isTrustError(error)) {
        notify('warn', '此操作需要先信任当前工作区', error.detail ?? null);
        return null;
      }
      fail(scm, error, `${label} 失败`);
      return null;
    }
  }

  const actions = {
    stage(paths, all = false) {
      const list = Array.isArray(paths) ? paths : [paths];
      return write(all ? '暂存全部' : `暂存 ${list.length} 个文件`, 'git.stage', { paths: list, all });
    },

    unstage(paths, all = false) {
      const list = Array.isArray(paths) ? paths : [paths];
      return write(all ? '取消暂存全部' : `取消暂存 ${list.length} 个文件`, 'git.unstage', { paths: list, all });
    },

    async discard(paths) {
      const list = Array.isArray(paths) ? paths : [paths];
      const accepted = await confirm({
        title: '丢弃更改？',
        body: `将丢弃 ${list.length} 个文件的未暂存修改，无法恢复。`,
        detail: list.slice(0, 5).join('\n') + (list.length > 5 ? `\n…等 ${list.length} 个文件` : ''),
        confirmLabel: '丢弃',
        danger: true,
        irreversible: true,
      });
      if (!accepted) return null;
      // Untracked files are deleted by the Host, tracked ones are restored from the index;
      // the split has to come from the last status snapshot (docs/git-model.md §6.3).
      const untracked = (scm.getSnapshot().status?.untracked ?? [])
        .map((change) => change.path)
        .filter((path) => list.includes(path));
      return write(`丢弃 ${list.length} 个文件`, 'git.discard', { paths: list, untracked, all: false });
    },

    async commit(message, { all = false, amend = false } = {}) {
      const text = String(message ?? '').trim();
      if (!text) {
        notify('warn', '提交信息不能为空', null);
        return null;
      }
      const result = await write(amend ? '修订提交' : '提交', 'git.commitCreate', { message: text, all, amend });
      if (result) notify('info', '提交完成', null);
      return result;
    },

    async checkout(ref, { force = false } = {}) {
      const accepted = await confirm({
        title: force ? '强制切换分支？' : '切换分支？',
        body: force ? `将丢弃工作区未提交的修改并切到 ${ref}。` : `当前工作区需要是干净的才能切到 ${ref}。`,
        confirmLabel: force ? '强制切换' : '切换',
        danger: force,
        irreversible: force,
      });
      if (!accepted) return null;
      return write(`切换分支 ${ref}`, 'git.checkout', { ref, force });
    },

    loadRefs() {
      return client.call('git.refs', {}).then((refs) => {
        scm.patch({ refs });
        return refs;
      }).catch((error) => {
        fail(scm, error, '无法读取分支');
        return null;
      });
    },

    async createBranch(name) {
      const value = await prompt({
        title: '新建分支',
        body: '从当前 HEAD 创建并切换',
        placeholder: 'feature/…',
        value: name ?? '',
        confirmLabel: '创建',
      });
      if (!value) return null;
      return write(`创建分支 ${value}`, 'git.branch', { name: value, action: 'create' }).then(async (result) => {
        if (result) await actions.checkout(value, { force: false });
        return result;
      });
    },

    async deleteBranch(name) {
      const accepted = await confirm({
        title: '删除分支？',
        body: `将删除本地分支 ${name}。已合并的分支才能删除。`,
        confirmLabel: '删除',
        danger: true,
      });
      if (!accepted) return null;
      return write(`删除分支 ${name}`, 'git.branch', { name, action: 'delete' });
    },

    async createTag(name) {
      const value = await prompt({
        title: '新建标签',
        body: '在当前 HEAD 上创建轻量标签',
        placeholder: 'v1.0.0',
        value: name ?? '',
        confirmLabel: '创建',
      });
      if (!value) return null;
      return write(`创建标签 ${value}`, 'git.tag', { name: value, action: 'create' });
    },

    async loadStashes() {
      try {
        const result = await client.call('git.stash', { action: 'list' });
        scm.patch({ stashes: result?.entries ?? [] });
        return result;
      } catch (error) {
        fail(scm, error, '无法读取贮藏');
        return null;
      }
    },

    async stashPush() {
      const message = await prompt({
        title: '贮藏当前修改',
        body: '未提交的修改会移出工作区，可用「弹出」找回。',
        placeholder: '可选说明',
        confirmLabel: '贮藏',
      });
      if (message === null) return null;
      return write('贮藏修改', 'git.stash', { action: 'push', ...(message ? { message } : {}) });
    },

    async stashPop(index = 0) {
      return write('弹出贮藏', 'git.stash', { action: 'pop', index });
    },

    openDiff(path, target = { kind: 'working' }) {
      return openFile(path, { diff: target });
    },
  };

  return actions;
}

export { IdeError };
