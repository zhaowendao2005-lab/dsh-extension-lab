# dsh-extension-lab

私有 DSH（DeepSeek Harness）扩展源码仓库与发布目录。

这个仓库同时承担三件事：存放扩展源码、维护机器可读的目录文件 `marketplace.json`、以及提供一条「构建 → 校验 → 打标签 → 发布」的固定发布链路。仓库里的包都以 Git 仓库子目录的形式被 DSH 安装，因此**构建产物必须入库**，否则安装下来是空壳。

## 仓库内容

| 包 | 作用 |
| --- | --- |
| `packages/extension-lab-manager` | 市场管理器：读取 `marketplace.json`，在 DSH 里提供安装 / 更新入口 |
| `packages/dsh-ui-enhancements` | 独立 UI 样式增强（对话框、控件、主题细节），带截图与对比度校验 |
| `packages/dsh-plugin-dev-sandbox` | 按 DSH 会话绑定插件目录；提供独立 profile 的 DSH 调试实例与右侧调试面板（不是 OS 安全沙箱） |

## 环境要求

- Node.js `>= 22.19.0`
- pnpm `12.15.0`（见根 `package.json` 的 `packageManager`，建议用 corepack 启用）
- 发布额外需要 `gh`（GitHub CLI）且已登录，远程仓库为 `git@github.com:zhaowendao2005-lab/dsh-extension-lab.git`

## 目录结构

```text
marketplace.json              # 发布目录：生产环境的唯一来源
scripts/release.mjs           # 发布链路：check / prepare / publish
package.json                  # 根脚本，聚合各包
packages/<name>/
  package.json                # 含 dsh.manifestVersion / dsh.bundle.patch / dsh.client.inject
  cordis.patch.yml            # 宿主补丁层：把插件挂到 /bundles/<name>
  src/client.template.js      # 客户端入口（ModuleLoader）
  src/index.js                # 宿主入口（export function apply）
  scripts/build.mjs           # 生成 lib/，并校验上面两个入口的形态
  lib/                        # 构建产物，入库，禁止手改
  test/                       # node:test 用例（宿主逻辑）
  README.md                   # 包级说明
```

## 常用命令

在仓库根目录执行：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 三个包都按**开发态**构建；manager 内嵌带 `link:` spec 的目录，市场页可直接装本地包 |
| `pnpm build` | 三个包都按**生产态**构建；产物里不含任何本地路径 |
| `pnpm test` | 客户端构建自检 + 对比度 / 选择器 / 截图校验 + 宿主单元测试；真实插件包 DSH smoke 需显式开启 |
| `pnpm release:check` | 校验包版本、目录版本、`spec` 与远端 tag 是否一致（会访问 GitHub） |
| `pnpm release:prepare -- --tag version-2.3.0` | 把目录里所有条目的 `ref` / `spec` 固定到该 tag，然后构建并测试 |
| `pnpm release:publish -- --tag version-2.3.0` | 再测一遍 → 提交 → 打标签 → 推送 main 和 tag → 建 GitHub Release |

单包命令：`pnpm --dir packages/<name> run build`、`pnpm --dir packages/<name> test`。

## 开发规则（固化）

以下条款是硬性约定，改代码前先读一遍；`release:check` / `release:publish` 会拦截其中一部分，其余靠 review 保证。

### 1. 源码与产物

1. 只改 `src/`、`scripts/`、`cordis.patch.yml`、`package.json`、`README.md`、`test/`、`marketplace.json`。
2. `lib/client.js`、`lib/index.js` 一律由 `pnpm build` 生成，**禁止手改**；改完源码必须重新构建再提交。
3. 构建产物**必须提交**。`.gitignore` 里对 `lib/` 开了例外 `!packages/*/lib/`，删掉这个例外会导致安装下来的包缺产物。
4. 提交前必须 `pnpm test` 通过；若动了客户端样式，确认 `packages/dsh-ui-enhancements/preview/out/*.png` 截图仍符合预期。

### 2. 目录与版本

5. `marketplace.json[].version` 必须等于对应包 `package.json` 的 `version`，不一致时 `release:*` 直接失败。
6. `marketplace.json[].path` 必须是 `packages/<name>`，`name` 必须等于包名。
7. 每个条目必须带**显式** `spec`，格式：
   `github:zhaowendao2005-lab/dsh-extension-lab#<ref>&path:/<path>`
   其中 `<ref>` 必须与同条目的 `ref` 字段一致。
8. 禁止在 `marketplace.json` 里出现本地绝对路径、`file:`、`link:` 等开发态 spec；生产目录只能指向 GitHub 上的 tag。
9. 改了某个包的代码并要对外可用时，必须 bump 该包 `version` 并同步目录，否则市场页识别不出「有更新」。

### 3. 发布流程

10. 发布只能走 `release:prepare` → 人工 review `git diff` → `release:publish`，**禁止**手工 `git tag`、手工改 `ref` 后直接 push。
11. tag 必须符合 `version-<数字...>` 格式；每个 tag 对应一次全仓发布，所有条目共用同一个 tag。
12. `prepare` 要求：当前在 `main`、工作区干净、本地 `main` 与 `origin/main` 完全一致、tag 不存在。
13. `publish` 要求：只包含发布相关文件改动、`gh auth status` 通过；它会先跑 `pnpm test` 再提交。
14. 发布后 tag 里的每个包都必须含 `lib/`、`cordis.patch.yml`、`package.json`，可直接被 DSH 安装。

### 4. 本地联调

15. 开发态用 `pnpm dev`：manager 构建会读 `marketplace.json` 并把每个条目的 spec 换成 `link:` + 本地绝对路径。
16. 仓库根目录可用环境变量 `DSH_EXTENSION_LAB_ROOT` 覆盖，**禁止**把本机路径写死进任何 `scripts/*.mjs`。
17. `link:` 只存在于开发态构建产物里，永远不要提交进仓库或写进 `marketplace.json`。
18. `link:` 安装后：改代码 → 重新 `pnpm build` → 刷新页面；宿主侧改动需要重启 DSH 才生效。

### 5. 插件结构硬性要求

19. `package.json` 必须包含：`dsh.manifestVersion`、`dsh.bundle.patch`、`dsh.client.inject`、`engines.dsh`、`engines.node`、`exports["."]`、`exports["./client"]`。
20. `cordis.patch.yml` 只做一件事：**用 `insert` 行**把本包插进 profile 层栈：

    ```yaml
    - insert:
        - id: <package-name>
          name: <package-name>
    ```

    不要写 JSON-Patch 的 `op / path / value`。profile 加载器只接受 `insert` 行和带 `id` 的定向 patch，写错会让**整个 bundle 被静默跳过**（启动报 `patch: id is required for non-insert patches`），外部表现就是「装好了但界面里什么都没有」。
21. 客户端入口必须写成 `window.__ModuleLoader__.load({ id, factory })`，并声明 `module.exports.inject`（用到的宿主服务）；构建脚本会校验 ModuleLoader 形态。
22. 宿主入口必须是 `export function apply(ctx, config)`；构建脚本会校验该签名。
23. 客户端代码不要 `import` 宿主包的具体内部路径，宿主能力一律通过 `inject` 到的服务获取（`ctx.slots`、`ctx.sidebarRightTabs`、`ctx.webTerminals` 等）。
24. 客户端模板禁止硬编码本机绝对路径 / 用户名 / 端口；需要构建期信息就参考 manager 的 `__MARKET_CONFIG__` 占位符注入方式。
25. 依赖未公开的宿主 API 前，先确认签名（本仓库研究用的 `extracted_files/` 是本地解包，不入库），并把结论写进包 README。

### 6. 测试与验收

26. `dsh-plugin-dev-sandbox` 的纯 Host 管理器用 `node:test` 覆盖会话绑定隔离、路径/链接校验、环境清理、进程并发与退出清理；禁止只测已废弃的 helper 或占位子进程。
27. 客户端 UI 改动必须跑 `pnpm --dir packages/dsh-ui-enhancements test`（构建自检、对比度、选择器、截图）；涉及新插件 UI 时还需在 DSH Web GUI 验证会话切换、面板交互和错误状态。
28. 发布前 `pnpm release:check` 必须通过：它会用 `git ls-remote` 验证 `spec` 里的远端 tag 真实存在。需要真实 DSH 插件集成验收的功能，须另跑针对当前包（非通用 fixture）的 `DSH_SANDBOX_PLUGIN_SMOKE=1` smoke，并验证 Host apply、Typert 注册、Remote mount 和资源加载。

### 7. 不入库的内容

`.dsh/`（会话绑定与沙箱运行时，可能含本地状态）、`.dsh_plugin_dev/`、`.dsh-plugin-dev.json`、`node_modules/`、`extracted_files/`（官方 app.asar 本地解包）、各包 `preview/out/` 截图产物 —— 已在根或包级 `.gitignore` 中忽略，不要为了「方便」提交它们。

## 目录格式（marketplace.json）

```json
{
  "schemaVersion": 1,
  "extensions": [
    {
      "name": "extension-lab-manager",
      "title": "Extension Lab Manager",
      "description": "私有扩展市场、安装与更新管理器。",
      "version": "1.0.2",
      "path": "packages/extension-lab-manager",
      "ref": "version-2.2.0",
      "spec": "github:zhaowendao2005-lab/dsh-extension-lab#version-2.2.0&path:/packages/extension-lab-manager"
    }
  ]
}
```

- `spec` 是权威字段，安装时原样交给 DSH；没有 `spec` 时管理器会回退到用 `ref` + `path` 拼同样的字符串。
- `ref` 可写分支、tag 或 commit，但生产目录必须 pin tag，保证可复现。
- 清单只负责「发现」，列出来不等于安装或启用。
- 生产态 manager 从
  `https://raw.githubusercontent.com/zhaowendao2005-lab/dsh-extension-lab/main/marketplace.json`
  拉取目录（`cache: "no-store"`），所以目录改动 push 到 `main` 后即生效。

## 安装模式

| 模式 | spec | 用途 | 生效方式 |
| --- | --- | --- | --- |
| 生产 | `github:<owner>/<repo>#<tag>&path:/<pkg>` | 正常安装 / 更新 | pnpm 从 GitHub 取该 tag 的包，装进 profile |
| 开发 | `link:<本地绝对路径>` | 本地联调（仅 `pnpm dev` 产物） | 目录软链，改代码重构建后刷新 |

行为说明：安装会写入 profile 的 `package.json` 与锁文件，并把包加入 `dsh.profile.bundles`；首次安装默认启用。同一包已存在时 `install_bundle` 会返回 `already-installed`，需要先 `remove_bundle` 再装（或由市场页的更新动作处理）。安装完成后 `application` 为 `applied` 表示已热应用，否则会提示需要重启。

## 发布一次新版本

```bash
# 0. 干净起点：确认在 main 且与远端一致
git switch main && git pull

# 1. 改代码并自测
pnpm test

# 2. bump 受影响的包版本，并同步 marketplace.json 的 version
#    （两者必须相等，否则 release:check 失败）

# 3. 提交并推送业务改动
git add -A && git commit -m "..." && git push origin main

# 4. 固定目录到新 tag（会改 ref/spec，然后 build + test）
pnpm run release:prepare -- --tag version-2.3.0

# 5. 人工 review
git diff

# 6. 发布：再次测试 → 提交 → 打 tag → push main + tag → GitHub Release
pnpm run release:publish -- --tag version-2.3.0

# 7. 校验
pnpm run release:check
```

发布后在 DSH 的插件市场页点更新，或直接用 `plugin_manager` 安装对应 `github:...#<新 tag>&path:/<包>` 的 spec。

## 新增一个插件

1. 复制一个现有包的结构到 `packages/<name>/`，至少包含 `package.json`、`cordis.patch.yml`、`src/client.template.js`、`src/index.js`、`scripts/build.mjs`、`README.md`。
2. 根 `package.json` 的 `dev` / `build` / `test` 三条脚本都把新包加进去。
3. `marketplace.json` 增加条目：`version` 与包一致、`path` 为 `packages/<name>`、`ref` 为当前发布 tag、`spec` 显式写全。
4. `pnpm test`、`pnpm release:check` 通过后按「发布一次新版本」走一遍。

## 排查

| 现象 | 处理 |
| --- | --- |
| `lib/client.js is stale` / `manager build is up to date` 报错 | 忘了 `pnpm build`，重新构建并提交产物 |
| `already-installed` | 先 `remove_bundle`，再 `install_bundle` |
| `release:publish` 报 `The following paths are ignored` | 检查 `.gitignore` 里 `!packages/*/lib/` 例外是否被删掉 |
| `release:publish` 报 `unrelated changes are present` | 工作区有非发布改动，先提交或还原 |
| `release:prepare` 报 `local main must match origin/main` | 先 push 或 pull 到一致 |
| 市场页目录为空 / 401 | 生产目录走 `raw.githubusercontent.com`，确认 `main` 上的 `marketplace.json` 可访问；页面 401 是 Web 鉴权，用启动时打印的带 token URL 打开 |
| 安装成功但界面没变化 | 客户端插件需刷新页面，宿主插件需重启 DSH |
| 装好了但哪都找不到入口 | 十有八九是 bundle patch 格式错（见规则 20）或宿主入口 import 缺文件（见规则 29）；用 `DSH_HOME=/tmp/x dsh --profile y --dump-config` 能看到合成后的行是否出现 |

29. 宿主入口允许拆成多个文件；`scripts/build.mjs` 必须把 `src/*.js`（客户端模板除外）全部拷进 `lib/`。只拷 `index.js` 会留下悬空 import，导致 Host 在启动时因 `ERR_MODULE_NOT_FOUND` 不加载。
30. 客户端注册使用官方 `ctx.effect` 管理资源生命周期，且必须让 API/注册错误显式失败；不要用吞掉异常的 `safe()` 包装。静默降级会把真实契约错误伪装成「偶发没有入口」，无法可靠验收。
