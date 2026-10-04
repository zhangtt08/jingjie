# 源码恢复记录（SOURCE-RECOVERY）

> `src/renderer/index.html:11` 与 `src/` 下另外 45 个 `.js` 文件的头部注释写着
> "Provenance: see docs/SOURCE-RECOVERY.md"。这份文件就是那一份 —— 它回答三件事：
> **这棵树从哪儿来**、**怎么机械地再来一次**、**哪些东西救不回来**。
> 使用与验收不在这里，在根目录的 `README.zh-CN.md` / `README.md`。

---

## 1. 这棵树的来历

本仓库最初**没有源码**，只有一份装好就用的产物：`净界 0.2.0-beta.6` 的安装目录
（Electron 43.4.0 打出来的包，现在这台机器上放在 `JingJie-runtime/`；`.gitignore` 把整个目录排除，
所以仓库里看不见它）。产品的源码树在上一台机器上，没有版本控制。

现在仓库里的代码是这么来的：

```
安装产物 JingJie-runtime/
  ├── resources/app.asar            ← 唯一的代码载体（构建输出，未压缩）
  ├── resources/providers/*.ps1     ← 真实能力的来源，散在 asar 外面
  └── resources/fs-helper/*.exe     ← 原生删除护栏二进制，不在 bundle 里，救不回来
          │
          │ node tools/extract-asar.mjs        零依赖 .asar 解包器（按磁盘格式自己解析）
          ▼
     _recovery/asar/                            抽出 out/ 与 package.json
          │
          │ node tools/recover-source.mjs       按原始模块边界做行区间切片
          ▼
     src/main/*.js  src/preload/preload.cjs  src/renderer/**  scripts/providers/*.ps1
          │
          │ 手工补上的那一层（§6）
          ▼
     仓库现在的源码 + 四道门禁
```

`package.json` 的 `description` 里"源码由 0.2.0-beta.6 安装产物恢复"就是这件事；
`_recoveredRuntimeVersions` 记的是从那份归档里量到的依赖版本（electron / esbuild / react / lucide-react），
**不是当前安装清单** —— 仓库现在 `dependencies: {}`，devDependency 只有 `electron@43.4.0`。

## 2. 为什么能按模块切开（而不是只能读一个巨型 bundle）

electron-vite 的产出是 **esbuild 拼接、未压缩**的：函数名、变量名、注释结构、代码顺序全部保留，
只是每个原始模块的顶层声明被平铺进同一个文件，重名符号加了 `$1`/`$2` 后缀
（bundle 里的 `canonical$6`、`isAtOrBelow$2`、`hasCode$1` 等）。

所以恢复 = **按行区间切片 + 机械补 import/export**，方法体一个字节都不改：

- 每个模块的区间写死在 `tools/recover-source.mjs` 的 `MAIN_MANIFEST`（33 项）与
  `RENDERER_MANIFEST`（13 项）里；
- `renames` 表只把 esbuild 的碰撞后缀改回该模块自己的 canonical 名
  （`canonical$6` → `path-guard.js` 里的 `canonicalRule`）；**同名 helper 在其他模块里的副本不合并** ——
  原源码每个模块本来就有自己那一份，合并反而改语义；
- 两份清单各带一个覆盖率守卫：bundle 主体（main 的第 14–3331 行、renderer 的整个 app 区）
  每一行必须**恰好落进一个模块**，重复占用或漏行都直接 `throw`，不产出半成品树。

渲染层还多一步机械推导：`src/renderer/vendor.js`（React 19.2.8 + react-dom + scheduler + lucide-react
那个 chunk）导出哪些符号，是拿"app 区实际引用到的 vendor 顶层声明"算出来的，不是手抄；
每个 renderer 模块的 import 也按 符号 → 模块 表生成。这套源码因此**不需要打包器也不需要安装步骤**
就能直接跑 —— `src/renderer/index.html` 的入口指 `./app.js`，不指 `assets/index-*.js`
（那是构建输出的哈希名，树里根本没有，指过去双击只会得到空白窗口）。

## 3. `tools/extract-asar.mjs` 实际做什么

只读输入归档、只写输出目录，只用 Node 内置模块。asar 的磁盘布局是 Chromium Pickle 的两层嵌套
（这张表就是 `tools/extract-asar.mjs` 顶部注释里那份，本机按它现造归档跑通过）：

```
0  : UInt32LE = 4                 外层 payloadSize
4  : UInt32LE = headerBlockLen    头部块字节数（含对齐填充）
8  : UInt32LE = headerBlockLen-4  内层 payloadSize
12 : UInt32LE = jsonLen           目录 JSON 的 UTF-8 字节数
16 : jsonLen 字节的 JSON + 补到 4 字节对齐
8 + headerBlockLen : 文件内容区    各文件 offset 相对这里
```

它按这张表自己取长度，解析前做边界检查（`8+headerBlockLen` 不许超过文件大小、`8+jsonLen` 不许超过
头部块、offset 必须是安全非负整数），目录 JSON 是 `JSON.parse` 出来的 —— 长度取错就抛，不静默继续。
每个条目解出来后按头部的 `integrity.hash` **现算 SHA-256 比对**，不做"看起来对了"的假设。

行为与退出码（下表每一行都在本机跑过）：

| 命令 | 实测结果 | 退出码 |
| --- | --- | --- |
| `node tools/extract-asar.mjs` | `usage: node tools/extract-asar.mjs <archive.asar> <outDir> [--verify] [--list] [--quiet]` | 2 |
| `node tools/extract-asar.mjs <archive> <out> --list` | 打印布局统计 + 每行 `f\t<size>\t<path>`，不落盘 | 0 |
| `node tools/extract-asar.mjs <archive> <out> --verify` | `layout check : OK (sizes tile the data region exactly)`、`integrity verified: 1, corrupt: 0` | 0 |
| 同上，但把内容区翻一个字节 | `integrity verified: 0, corrupt: 1` + `CORRUPT /hello.txt: expected … got …` | 1 |
| `npm run extract:asar`（本仓库脚本） | `Error: ENOENT … JingJie-runtime\resources\app.asar` —— 原始归档现在不在这台机器上（§7） | 1 |

后三行的"归档"是按上面那张布局表现造的 295 字节合成归档（临时目录里，用完即删），
因为产品那份 `app.asar` 已经不在这台机器上（见 §7）。

另外两条实现事实：符号链接条目不跟着创建，写成 `<路径>.asar-link.txt` 说明它指向哪儿
（本归档没有符号链接，仍实现）；`unpacked: true` 的条目如果旁边有 `*.asar.unpacked` 就从那份拷。
入口名走 `assertSafeName` 的白名单式拒绝（空、`.`、`..`、含 `/` `\` 或 `<>|:*?"` 一律抛），
所以归档里的名字跳不出输出目录。stdout 只允许 ASCII —— Windows 控制台是 GBK，中文会乱
（这条约定原先写在一份没有随产物救出来的运行手册 `docs/RUNBOOK.md` 里，见 §7 末段）。

## 4. `tools/recover-source.mjs` 实际做什么

```
node tools/recover-source.mjs <extractedAsarDir> <repoRoot> [--providers-dir <dir>] [--dry-run] [--force]
```

四件事，顺序固定：

1. **main**：读 `<extracted>/out/main/main.js`，先跑覆盖率守卫，再按 `MAIN_MANIFEST` 写 33 个
   `src/main/*.js`，文件头自动带上 "Provenance: see docs/SOURCE-RECOVERY.md…" 那几行注释。
2. **preload**：`out/preload/preload.cjs` 逐字节拷成 `src/preload/preload.cjs`。
3. **renderer**：读 `out/renderer/assets/index-BqZXDE4.js`，用 `function getJingJieApi` 那一行
   切出 vendor 区与 app 区；vendor 区整体写成 `src/renderer/vendor.js`（含机械导出的符号表），
   app 区按 `RENDERER_MANIFEST` 切成 `app.js`、`lib/*.js`、`components/*.js` 共 13 个模块，
   import 按 符号→模块 表自动生成；`index.html`、`*.css`（按实际存在的哈希名找）、
   `win-controls.js` 原样拷进 `src/renderer/`。
4. **providers**：给了 `--providers-dir` 就把安装目录里散开的 `*.ps1` 拷进 `scripts/providers/`
   —— 真实能力来源不在 asar 里面。

本机实测到的一条硬边界：**它拒绝覆盖已存在的树**。

```
$ npm run recover:source
refusing to overwrite an existing src/ or scripts/ tree: this tool writes the raw recovery,
while the repository carries the audited version on top of it. Re-run with --force only if you
intend to redo the security fixes by hand (see docs/SOURCE-RECOVERY.md).
exit code 4
```

为什么退出码是 4 而不是 0：`--force` 会把 §6 列的那些手工安全修复**整片抹掉**，
而工具自己没法把那些修复重放一遍。真按 `--force` 走，就得把 §6 从头再做一遍并重新跑四道门禁。

⚠ 诚实交代本轮的覆盖范围：**只实跑了它的拒绝分支**（上面那段，退出码 4）。
`--dry-run` 与真正的切片需要原始 `app.asar` 抽出来的目录，本机现在没有那份归档（§7），
所以"切片本身能跑通"的证据是 2026-10-02 那次已经落进仓库的产物
（`src/` 的文件头 + `npm run check` 与 `test/renderer-modules.test.js` 现在仍然绿），
不是本轮重跑出来的。两份清单的行号是照那份 bundle 写死的，**换一份构建产物就会错位** ——
覆盖率守卫会把它抓出来（区间重叠或漏行直接抛），不会静默产出错位源码。

## 5. 清单（模块 → bundle 行区间）

`MAIN_MANIFEST`（相对 `out/main/main.js`，1-based 闭区间）：

| 模块 | 区间 | 职责 |
| --- | --- | --- |
| window-options.js | 14–27 | 窗口选项（preload 路径、图标、webPreferences） |
| **path-guard.js** | 28–152 | **唯一的安全边界**：规则根白名单、受保护根、符号链接/再解析点拒绝、realpath 二次核 |
| rules.js | 153–162 | 默认清理规则目录 |
| storage.js | 163–279 | 崩溃安全的 JSON store + 串行执行器 |
| quarantine.js | 280–474 | 7 天可恢复隔离区（哈希核对的移动/还原、到期清理） |
| cleanup-engine.js | 475–706 | 扫描 → 再验证 → 删除/隔离，逐项回执 |
| request-validators.js | 707–763 | 严格 IPC 形状检查（只收 id，从不收路径或命令） |
| cleaner-controller.js | 764–939 | 深度清理控制器 |
| ipc.js | 940–1007 | IPC 通道表 + 可信发送方包装 |
| native-delete.js | 1008–1146 | fs-helper 子进程：锚定 + 大小/mtime 核对的单文件删除 |
| powershell-runner.js | 1147–1191 | allowlisted provider 脚本，base64 入 / JSON 出 |
| software-inventory.js | 1192–1251 | 注册表 + appx 清单归一化与去重 |
| software-policy.js | 1252–1343 | 卸载风险分级：什么绝不可以被本软件移除 |
| software-provider.js | 1344–1356 | 软件 provider 适配层 |
| uninstall-plan.js | 1357–1474 | 命令行计划：无 shell、屏蔽解释器宿主、msi/appx/exe |
| software-controller.js | 1475–1653 | 卸载作业与逐项持久结果 |
| elevation.js | 1654–1704 | 提权进程执行器（fs-helper 的 UAC 桥，`shell:false` + 超时） |
| uninstall-executors.js | 1705–1771 | 直接/提权执行器、appx 执行器、退出码归一化 |
| startup-inventory.js | 1772–1837 | 启动项归一化（注册表 / 启动文件夹 / 计划任务） |
| startup-policy.js | 1838–1877 | 哪些启动项绝不该被碰 |
| startup-effects.js | 1878–1962 | 按类别的诚实影响说明（不编造秒数） |
| startup-provider.js | 1963–1978 | 启动项 provider 适配层 |
| startup-actions.js | 1979–2097 | 可逆的关闭/还原：`.reg` 备份 + 值再核对 + 文件改名进备份根 |
| startup-controller.js | 2098–2201 | 启动项作业账本 |
| elevated-startup-runner.js | 2202–2240 | 走 fs-helper 的提权启动项执行器 |
| aggressive-native.js | 2241–2387 | fs-helper v2 会话：删除前先把受保护根清单交给原生侧 |
| maintenance.js | 2388–2486 | Windows 官方维护动作（传递优化 / 组件清理），一次提权一个动作 |
| protected-roots.js | 2487–2549 | 个人文件夹 + 云同步根的词汇与物理两级解析 |
| aggressive-rules.js | 2550–2625 | 可重建缓存目录（固定根 + 发现的浏览器 profile） |
| aggressive-scan.js | 2626–2858 | 扩展清理扫描：逐规则物理校验、分类、总量 |
| aggressive-controller.js | 2859–3190 | 扩展清理控制器：候选快照 → 逐文件再验证 → 删除/清空/维护 |
| window.js | 3191–3237 | 唯一的应用窗口（无边框、sandbox、导航锁定）；恢复后按 S-01 改过，见 §6 |
| index.js | 3238–3331 | 组装根（本轮把控制器构造抽进 services.js，见 §6） |

`RENDERER_MANIFEST`（相对 renderer bundle）：`lib/app-info.js` 12804–12830、
`components/Sidebar.js` 12831–12877、`lib/format.js` 12878–12888 **+ 13084–13094（两段）**、
`components/ScanPanel.js` 12889–12962、`components/MetricList.js` 12963–12991、
`components/ResultsPanel.js` 12992–13010、`components/QuarantinePanel.js` 13011–13053、
`components/HistoryPanel.js` 13054–13082、`lib/software.js` 13083 **+ 13095–13125（两段）**、
`components/SoftwarePanel.js` 13126–13419、`components/StartupPanel.js` 13420–13603、
`components/AggressivePanel.js` 13604–13903、`app.js` 13904–文件末。

（`lib/format.js` 与 `lib/software.js` 各有两段：bundle 把它们的声明分开放了，切片必须照它放。）

## 6. 恢复之后手工补上去的那一层（`--force` 会把它抹掉）

`src/main/` 现在 36 个文件，清单只解释 33 个。多出来的是仓库自己写的：

| 文件 | 为什么不在 bundle 清单里 |
| --- | --- |
| `services.js` | 把原先平铺在 `app.whenReady()` 里的控制器构造抽成不依赖 Electron 的组装根，好让 Agent API（`agent/tools.mjs`）与测试驱动**同一批**控制器、同一套护栏，而不是第二套实现 |
| `plan-controller.js` | 四分区统一计划快照：`build` / `entriesOf` / `preview`(dry-run) / `execute`，15 分钟过期，逐条回执，`retry` 只重试真失败的 |
| `retry-policy.js` | "这条结果能不能重试"的唯一判据（策略拒绝与快照过期不重试） |

`src/main/` 里不写 "Provenance: see docs/SOURCE-RECOVERY.md" 的文件正是这三个外加 `window.js`
（它的头部写的是自己的恢复注记 + 下面那两条评审标记）。

清单里的模块也**不是逐字节等于 bundle**。以下几处是本仓库加的加固，代码里都带 `SECURITY-REVIEW` 标记：

- **S-01** `window.js` + `plan-controller.js`：装好的产物把窗口对象挂在 `globalThis.__jjWin` 上，
  无边框窗口的 IPC（minimize / toggle-maximize / close / is-maximized）注册在 `createWindow()` 里、
  用 `globalThis.__jjWinHandlers` 挡重复注册，**没有任何发送方校验** —— 而每一个 `jingjie:*` 通道都有。
  现在这些处理器回到模块作用域并走同一个可信发送方判定。
  `plan-controller.js` 另一半是同一个编号：只有 `preview()` 摊开过的 id 才可能被执行，
  没摊开过的整段拒绝并如实回执。
- **S-02** `request-validators.js` + 四个控制器：每个破坏性请求都必须带 `confirm: true`。
  装好的 0.2.0-beta.6 只收 `{taskId, itemIds}` 就动手，唯一的"你确定吗"是渲染层的一个按钮。
- **S-03** `plan-controller.js` / `aggressive-*`：不可逆动作（清空回收站）永不默认勾选，
  除 `confirm` 之外还要 `acknowledgeIrreversible: true`。
- **S-04** `aggressive-controller.js`：原生护栏不在就没有受保护根清单，此时按 fail closed 拒绝，
  不降级成"用 JS 直接删"。
- **S-05** `startup-actions.js` + `aggressive-controller.js`：装好的产物**先删再留副本**
  （Run/RunOnce 值删掉后唯一的还原资料在内存里；一处还把结构化克隆之前的数组落盘）。
  现在先写 Windows 原生的 `.reg` 备份，写不成功就拒绝删除。
- **S-06 / S-07** `powershell-runner.js`：解释器按 `%SystemRoot%` 解析、完全不查 PATH
  （provider 带 `-ExecutionPolicy Bypass`，其中一个还会写注册表）；每次调用前重新验证脚本
  不是再解析点、真实路径仍直接落在 `providerRoot` 里。
- `path-guard.js`：`environmentIsSafe()` 在环境缺变量时判"不安全"，而不是让
  `win32.isAbsolute(undefined)` 抛 TypeError（这条链下游会删文件，崩溃不等于拒绝）。
- `src/main/index.js` + `src/renderer/index.html`：入口接回真实源码（见 §2 末段）。
- `agent/local-guard.mjs` + `agent/token-store.mjs`（2026-10-05）：Agent API 的本机守卫 ——
  只准绑回环、Host 逐字判回环、Origin/Referer 只跟固定白名单比、非 GET 要令牌、永不发通配 CORS。
  判据与令牌规则写在 `agent/README.md`。

这些不是自称：`npm run check` 会解析 `src`/`agent`/`tools` 里每一条相对 import、核对 HTML 引用的每个
脚本与样式存在、核对五份 provider 脚本齐全、核对 8 个 Agent 工具的 schema/risk/handler 完整；
`test/renderer-modules.test.js` 核对每个具名 import 真的被目标模块导出；
`test/path-guard.test.js` 与 `test/agent-guard.test.js` 钉的是护栏本身的分支。

## 7. 救不回来 / 不在仓库里的东西

| 东西 | 现状 | 后果与应对 |
| --- | --- | --- |
| 原始 TypeScript + JSX 源码 | 没有。bundle 里 JSX 已被自动运行时编译成 `jsx()/jsxs()` | 现在这份是"未压缩 bundle 的模块切分"，能读能改，但变量名与文件边界是重建的，不保证与原作者的一字不差 |
| `resources/app.asar` 本身 | **不在这台机器上**；`.gitignore` 排 `*.asar` 与 `JingJie-runtime/` | §3/§4 的完整链路本轮无法重跑，`npm run extract:asar` 现在 ENOENT。源码已经落进 `src/` 并入库，asar 只是历史来源不是运行前提（`npm run smoke:runtime` 对此如实写着"源码在仓库内，asar 可缺"） |
| `fs-helper` 原生二进制 | 安装产物里有 `JingJie-runtime/resources/fs-helper/JingJieFsHelper.exe`（27,136 字节）；**它的源码不在仓库**，`vendor/` 与 `*.exe` 都被 `.gitignore` 排除 | 它才是删除时真正兜住保护边界的那一层。找不到时 `env_probe.fsHelperAvailable=false`，扩展清理与提权动作按设计 fail closed 报 `fs-helper-missing`。位置由 `JINGJIE_FS_HELPER` / 打包后的 `resources/fs-helper` / `agent/tools.mjs` 的候选表决定 |
| `node_modules` | 仓库里没有（只有 devDependency `electron@43.4.0`，当前未安装） | 界面走打包运行时；`npm start` 与打包需要先前 `npm install`。Agent 面（`agent/`、`tools/`、`test/`）零依赖 |
| `resources/brand/icon.png` 的原始矢量 | 只有产物里那张 PNG（已拷进 `assets/brand/`） | `package.json` 的 `build.win.icon` 就指这张 PNG |
| 版本号的唯一来源 | 恢复期产物带 `0.2.0-beta.6`（安装产物内的 `app/package.json` 与界面常量 `APP_VERSION`），仓库 `package.json` 是 `0.2.0` | 两份数字不许各说各话；对账的门禁见 README 的"打包"一节 |
| **四份评审/手册文档**：`docs/SECURITY-REVIEW.md`、`docs/PRODUCT-REVIEW.md`、`docs/SOURCE-REVIEW.md`、`docs/RUNBOOK.md` | **没有随产物救出来**，`docs/` 里现在只有这份 SOURCE-RECOVERY | 代码里还有 26 处按名字引用它们：5 处写成 `docs/<名字>.md` 的路径（`window.js` 的 SOURCE-REVIEW 与 SECURITY-REVIEW、`plan-controller.js` 与 `aggressive-controller.js` 的 PRODUCT-REVIEW、`tools/extract-asar.mjs` 的 RUNBOOK），其余 21 处是就地引用（18 处 `SECURITY-REVIEW` 编号标记，含 S-01…S-07；
3 处 `PRODUCT-REVIEW` 条目引用，含 #2 / #3 与缺陷 D-01）。每条的**实质内容就在紧邻它的那几行注释里**，本文 §6 只把 S 编号那几条收了一遍；不复述评审全文，也不假称那些文档在仓库里可查 —— 指一份不存在的文档正是本轮要修的那个毛病，所以这里只登记，不补一份假的 |

## 8. 想在另一台机器上重做一遍（顺序与前提）

```bash
# 0) 前提：手里有那份安装产物（目录或 ZIP），里面有 resources/app.asar
#    本机现在没有，所以这一整套只能在有归档的机器上做
# 1) 解包（--verify 逐文件核 SHA-256，坏了退出码 1）
node tools/extract-asar.mjs "<安装目录>/resources/app.asar" _recovery/asar --verify
# 2) 先看统计与区间是否还对得上（--dry-run 一个字都不写）
node tools/recover-source.mjs _recovery/asar . --providers-dir "<安装目录>/resources/providers" --dry-run
# 3) 只有在"确实打算手工重放 §6 那些安全修复"时才 --force
node tools/recover-source.mjs _recovery/asar . --providers-dir "<安装目录>/resources/providers" --force
# 4) 立刻跑四道门，别信"看起来切开了"
npm run check && npm test && npm run selftest && npm run smoke:runtime
```

第 2 步的 `--dry-run` 会先跑覆盖率守卫：行号一旦因为构建产物变了而错位，它会抛
`main coverage broken` / `renderer coverage broken` 并列出前 10 条，而不是产出错位的源码。
遇到这种情况要重的是**清单里的行区间**（按 bundle 的顶层声明顺序重新对齐），不是把守卫删掉。
