#!/usr/bin/env node
/**
 * Export the installed DSH's `dsh-doc` skill — plus a readable mirror of its
 * documentation and package references — into an Antigravity CLI (agy) skill
 * directory.
 *
 * Why: the shipped skill and the docs live inside `app.asar`. DSH's own file
 * tools can read that archive; the Antigravity CLI cannot (its `cat`, `grep`,
 * `ls`, `find` fail on asar), so an agent outside DSH sees nothing to read and
 * flails. This script copies the material out into plain files.
 *
 * Must run under the Electron runtime, which alone has asar-aware `fs`:
 *
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
 *     scripts/export-dsh-skill.mjs [--root <dir>] [--global | --out <dir>]
 *
 * Default target: <root>/.agents/skills/dsh-doc  (agy project skill discovery;
 * root is --root, else cwd). Nothing is written into agy's own directories.
 * --global:       ~/.gemini/skills/dsh-doc  (opt-in, leaks into every project)
 * --out:          any explicit directory
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const installDir = process.env.DSH_INSTALL_DIR
if (!installDir) {
  console.error('DSH_INSTALL_DIR is not set; run this from a DSH-provided shell.')
  process.exit(1)
}

const requireFromInstall = createRequire(path.join(installDir, 'package.json'))
const presetDir = path.dirname(requireFromInstall.resolve('@deepseek-ai/dsh-agent-preset/package.json'))
const skillSource = path.join(presetDir, 'skills', 'dsh-doc')
const packagesDir = path.dirname(installDir) // .../node_modules/@deepseek-ai
const dshVersion = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8')).version

const projectRoot = path.resolve(option('--root', process.cwd()))
const outDir = path.resolve(option('--out', flag('--global')
  ? path.join(os.homedir(), '.gemini', 'skills', 'dsh-doc')
  : path.join(projectRoot, '.agents', 'skills', 'dsh-doc')))

const stats = { copied: 0, bytes: 0, skipped: 0 }

function copyTree(from, to) {
  const stat = fs.statSync(from)
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      copyTree(path.join(from, entry.name), path.join(to, entry.name))
    }
    return
  }
  if (!stat.isFile()) {
    stats.skipped += 1
    return
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  stats.copied += 1
  stats.bytes += stat.size
}

// 1. The skill itself: SKILL.md, references/, templates/.
fs.rmSync(outDir, { recursive: true, force: true })
copyTree(skillSource, outDir)

// 2. Installed documentation (user guides, subsystems, catalogs, upgrade guides).
copyTree(path.join(installDir, 'docs'), path.join(outDir, 'dsh-docs'))

// 3. Per-package reference READMEs, flattened to one file per package and locale.
const packageFiles = []
for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkgRoot = path.join(packagesDir, entry.name)
  for (const readme of ['README.zh.md', 'README.md']) {
    const source = path.join(pkgRoot, readme)
    if (!fs.existsSync(source)) continue
    const targetName = readme === 'README.zh.md' ? `${entry.name}.zh.md` : `${entry.name}.md`
    copyTree(source, path.join(outDir, 'packages', targetName))
    packageFiles.push(targetName)
  }
}

// 4. Provenance: which install this snapshot came from, and how to refresh it.
const createdAt = new Date().toISOString()
const docsDir = path.join(outDir, 'dsh-docs')
const versionNote = [
  '# DSH 文档快照',
  '',
  '这份目录由 `scripts/export-dsh-skill.mjs` 从**已安装的** DeepSeek Harness 导出，供 Antigravity CLI（`agy`）这类读不了 `app.asar` 的 agent 使用。',
  '',
  `- DSH 版本：\`${dshVersion}\``,
  `- 导出时间：\`${createdAt}\``,
  `- 安装根：\`${installDir}\``,
  `- 文档：\`${docsDir}\`（${fs.readdirSync(docsDir).length} 个顶层条目）`,
  `- 包参考：\`${path.join(outDir, 'packages')}\`（${packageFiles.length} 个 README）`,
  '',
  '## 需要当前进程事实时',
  '',
  '快照只描述**安装时的代码与文档**，描述不了正在跑的进程。要看活实例（挂了哪些插件、某个 Service 的签名、某个 Slot 的占位），用 asar 感知的运行时直读：',
  '',
  '```sh',
  'ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \\',
  '  -e "console.log(require(\'node:fs\').readFileSync(process.argv[1], \'utf8\'))" \\',
  '  "<asar 内的绝对路径>"',
  '```',
  '',
  '## 刷新',
  '',
  'DSH 升级后快照会过期。重新导出（覆盖同一目录）：',
  '',
  '```sh',
  'ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \\',
  '  scripts/export-dsh-skill.mjs',
  '```',
  '',
  '## 边界',
  '',
  '- 这是**只读参考资料**，不是权限：导出不授权改动 DSH 安装、profile 或任何插件。',
  '- 版本号对不上时以安装目录里的 `README`/源码为准，别拿快照当现行事实。',
  '',
].join('\n')
fs.writeFileSync(path.join(outDir, 'VERSION.md'), versionNote)

// 4b. Keep the regenerable bulk out of git; the curated skill files stay tracked.
fs.writeFileSync(path.join(outDir, '.gitignore'), [
  '# 由 scripts/export-dsh-skill.mjs 生成的快照主体：随时可重新导出，不入库。',
  '# SKILL.md / references / templates / VERSION.md 是这份技能的可读正文，保留。',
  'dsh-docs/',
  'packages/',
  '',
].join('\n'))

// 5. Prepend the snapshot section to SKILL.md so the agent reads local files first.
const skillPath = path.join(outDir, 'SKILL.md')
const original = fs.readFileSync(skillPath, 'utf8')
const marker = '\n## 本机快照（Antigravity CLI 适配）\n'
if (!original.includes(marker)) {
  const insertAt = original.search(/\n#{1,3} /) // after frontmatter, before the first heading
  const section = [
    '',
    '## 本机快照（Antigravity CLI 适配）',
    '',
    `你在 Antigravity CLI 里运行，读不了 \`app.asar\`：\`cat\`、\`grep\`、\`ls\`、\`find\` 对它一律失效。`,
    `所以本 Agent 的事实来源是本目录下的快照，不是 DSH 安装目录。`,
    '',
    `- 已安装 DSH 版本：\`${dshVersion}\`（导出时间 \`${createdAt}\`）`,
    `- 文档镜像：\`${docsDir}\``,
    `- 包参考（每个 \`@deepseek-ai/*\` 包的 README）：\`${path.join(outDir, 'packages')}\``,
    `- 出处与刷新方式：\`${path.join(outDir, 'VERSION.md')}\``,
    '',
    '按下面的顺序查：',
    '',
    '1. 先读本目录的 `references/`（插件开发、组合包、UI、MCP、验证等专题）。',
    '2. 再按需读 `dsh-docs/`：`user/`（用户指南）、`subsystems/`（子系统契约）、`upgrade-guide/`（版本迁移）、`tool-catalog.md`、`config-catalog.md`、`persistence-catalog.md`。',
    '3. 要找具体包的行为，读 `packages/<包名>.zh.md`；`README.zh.md` 缺失时读 `packages/<包名>.md`。',
    '4. 快照里没有的（活进程、活的 Config 默认值、当前挂载的插件），说明“需要在 DSH 会话里用 cordis_inspect 查”，不要凭空补。',
    '',
    '写文件、装包这些动作仍然照 SKILL.md 正文的授权规则办：查资料不授权改动，改动要用户明确要求。',
    '',
  ].join('\n')
  const patched = insertAt > 0
    ? original.slice(0, insertAt) + '\n' + section + original.slice(insertAt)
    : original + '\n' + section
  fs.writeFileSync(skillPath, patched)
}

const mb = (stats.bytes / 1048576).toFixed(1)
console.log(JSON.stringify({
  outDir,
  dshVersion,
  filesCopied: stats.copied,
  megabytes: Number(mb),
  skillBytes: fs.statSync(skillPath).size,
  docsEntries: fs.readdirSync(docsDir),
  packageReadmes: packageFiles.length,
}, null, 2))
