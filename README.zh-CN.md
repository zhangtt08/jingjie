# 净界 · Windows 深度清理 / 软件卸载 / 启动优化

[English](./README.md) | **简体中文**

净界是一款**只在本机工作**的 Windows 维护工具：清理缓存与临时文件、卸载已安装的软件、
关掉登录时自动启动的项目。它把这三件事合成一份**可以先摊开再执行**的维护计划 ——
执行前每一个条目都会列出绝对路径、大小、是否需要管理员权限、是否不可恢复；
任何一步都没有"顺手就改了"这条路。

**它是什么**：本地桌面应用（Electron + 真实 PowerShell provider 脚本 + 原生删除护栏），
不联网、不上传、不注册账号、不收集任何遥测。扫描是只读的；改动只在你确认之后发生。

**下载/运行**：这台机器上现成的那一份是 `JingJie-runtime/JingJie.exe`（双击即用的安装产物，
自带 Electron 运行时与本仓库源码的同款副本）。仓库本身是源码 + 门禁，见下面的[开发与验收](#开发与验收)。

---

## 这个软件做什么

四个分区，各自有真实的能力来源（`scripts/providers/*.ps1` 与 `src/main/` 的控制器），
界面与 Agent 接口驱动的是**同一批**对象、同一套护栏，没有第二套实现。

| 分区 | 干什么 | 真实来源 |
| --- | --- | --- |
| 深度清理 | 六条固定规则：用户/系统临时文件、崩溃转储、Windows 错误报告归档、Edge 与 Chrome 缓存 | `src/main/rules.js` → `cleanup-engine.js`（扫描 → 逐文件再验证 → 删除或隔离） |
| 扩展清理 | 可重建缓存：显卡着色器缓存、缩略图/图标缓存、Discord/Slack/VS Code 的代码与图形缓存、npm/pip/NuGet 下载缓存，以及**现场发现的**浏览器 profile 缓存（Chrome/Edge/Firefox） | `src/main/aggressive-rules.js`（固定目录 + profile 发现）→ `aggressive-scan.js` |
| 软件卸载 | 注册表 Uninstall 四个视图 + `Get-AppxPackage` 的真实清单，只跑软件自己的卸载命令（注册过的可执行 / MSI / APPX） | `src/main/software-inventory.js`、`software-policy.js`、`uninstall-plan.js`、`scripts/providers/software-*.ps1` |
| 启动优化 | Run / RunOnce 注册表、启动文件夹、非 Microsoft 计划任务的真实清单，可逆地关闭并还原 | `src/main/startup-inventory.js`、`startup-actions.js`、`scripts/providers/startup-*.ps1` |

每条清理规则都自带一句诚实的话：动的是什么、会有什么后果、**保留了什么**
（例如浏览器缓存那条写明"保留书签、历史、Cookie、密码、扩展、网站数据和会话"）。
影响说明按类别写在 `startup-effects.js` 里，没有编造的"节省 N 秒"。

## 它绝不能碰什么

这不是承诺，是代码里的判据，每一条都有会红的测试守着：

- **个人文件夹与云同步根**：桌面 / 文档 / 下载 / 图片 / 视频 / 音乐 / OneDrive，
  外加 `%WindowsRoot%\System32`、`WinSxS`、`DriverStore` ——
  `src/main/path-guard.js` 的 `protectedRoots()`，每次扫描与删除**前都重新检查**，
  词汇层判一遍、`lstat` + `realpath` 物理层再判一遍。符号链接与再解析点直接拒。
- **环境不安全就不动手**：`environmentIsSafe()` 少任何一个环境变量都判"不安全"，
  所有规则当次拒绝（不是崩溃、也不是猜）。
- **系统组件与共享运行库**：Windows 更新、KB 补丁、Visual C++ 运行库、Windows Desktop Runtime；
  安全软件、VPN、输入法、驱动/固件类一律受保护；装在 `WindowsRoot` 下或整个 `Program Files` 根上的条目不动
  （`src/main/software-policy.js`，判据是 `OFFICIAL_ONLY_PATTERNS` / `IMMUTABLE_PATTERNS` 与路径归属）。
- **卸载不许当 shell 用**：卸载命令行里出现 `cmd/cscript/wscript/mshta/rundll32/regsvr32/powershell/pwsh`
  一律 `blocked-uninstall-host` 跳过（`src/main/uninstall-plan.js` 的 `BLOCKED_EXECUTABLES`）。
  所有子进程 `shell:false` 并带超时（含提权那条路 `src/main/elevation.js`）。
- **提权一次只干一件事**：官方维护动作只有两个白名单 id（`delivery-optimization` 传递优化缓存、
  `component-cleanup` Windows 组件清理），执行是 `fs-helper run-maintenance-action-elevated <id>`，
  `shell:false` + 超时，一次调用只允许一个 id，多一个都拒（`src/main/maintenance.js` 的 `ALLOWED_ACTIONS`；
  探测在 `scripts/providers/aggressive-maintenance.ps1`，它按 `%SystemRoot%\System32\Dism.exe`
  与 DeliveryOptimization 模块在不在来决定"支持"）。退出码 3010 老实报成"需要重启"。
- **默认永不勾选破坏性项**：软件卸载与启动优化**从不**被默认选中；含回收站这类不可恢复动作时，
  除了 `confirm` 还要 `acknowledgeIrreversible`。
- **接口不接受路径与命令**：IPC 只收 id（`src/main/request-validators.js` 的 id-only 严格形状），
  渲染进程被攻陷也拿不到"给我一个路径我就删"的能力；发送方还要过 frame URL 校验（`src/main/ipc.js`）。
- **Agent 接口不接受网页**：只接受打给 `127.0.0.1:<端口>` / `localhost:<端口>` / `[::1]:<端口>` 的请求，
  Origin/Referer 只跟固定回环白名单比（**永不**与请求自己的 Host 比），非 GET 必须带本机令牌，
  任何响应都不发通配 CORS —— 详见 [`agent/README.md`](./agent/README.md)。

## 可恢复性与账本

- 崩溃转储与错误报告这类规则是 **quarantine** 模式：文件移进隔离区（默认 7 天，带 SHA-256 核对），
  可以从界面还原，不是直接销毁。
- 启动项关闭是**可逆**的：注册表项先导出 `.reg` 备份、启动文件夹里的文件改名进备份根，还原走同一条路。
- 每次执行都逐条回执：`succeeded / skipped / failed / refused / reboot-required`，
  以及这一条的真实原因（`protected-root`、`symbolic-link`、`preview-required`、`software-locked`……）。
  重试只重试**真失败**的那些（`src/main/retry-policy.js`）——把一次刻意的拒绝再发一遍，
  就等于把闸门磨掉。
- 账本位置：界面写 `%APPDATA%\jingjie`；Agent 侧默认写仓库内 `.data/agent`（`.gitignore` 已排除），
  只读工具不会去写用户的真实 AppData。

## 开发与验收

要求 Node.js ≥ 22（本机实测 v24.18.0）。Agent 面、工具与测试**零运行时依赖**；
`electron` 只在开发模式与打包时才需要装。

下面每一条都在本机实际跑过并通过：

```bat
npm run check          :: 静态完整性：main/脚本/HTML/import 指向的文件真的在、文档里的仓库内引用都存在、8 个 Agent 工具声明完整
npm test              :: 单元测试 23 项（护栏、存储、重试策略、渲染层导出、Agent 本机守卫）
npm run selftest      :: 起真服务打真端点：契约 + 五道本机守卫，15 项
npm run smoke:runtime :: 运行时冒烟：安装运行时与 fs-helper 在位、provider 齐全、真跑一次软件清单
npm run verify        :: check + test + selftest 三道串起来
```

本机最近一次的实测结果：`check` 全部通过（93 处相对引用可解析、50 处文档引用都存在、8 个工具声明完整）、
`test` 23/23、`selftest` 15/15、`smoke:runtime` 6/6（`software-inventory.ps1` 真跑出 207 条）。

Agent 接口（本机统一注册表里净界占 **8796**）：

```bat
npm run agent:serve    :: 只监听 127.0.0.1:8796，端口被占按契约 +1 并写 agent/.endpoint
npm run agent:mcp      :: stdio MCP 桥（initialize / tools/list / tools/call）
```

自检脚本与桥都不需要人工设任何东西：非 GET 请求要带的本机令牌由服务启动时自动生成并落盘 0600，
读的是同一个每用户目录。工具面 8 个（7 只读 + 1 执行），逐条说明与被守卫的形状见
[`agent/README.md`](./agent/README.md)。

界面入口 `src/renderer/index.html` 指向的是恢复出来的源码本身（`./app.js`），
不需要打包器、不需要安装步骤 —— 这棵树的来历、能重做到什么程度、哪些东西救不回来，
写在 [`docs/SOURCE-RECOVERY.md`](./docs/SOURCE-RECOVERY.md)。

## 已知的边界与残留（不粉饰）

- 仓库**没有** `fs-helper` 原生删除护栏的源码，也没有可编译它的工程：安装产物里那份二进制在
  `JingJie-runtime/resources/fs-helper/`，但 `vendor/` 与 `*.exe` 都被 `.gitignore` 排除。
  所以从干净克隆打出来的包不带这层护栏，扩展清理与提权动作会**如实失败**
  （`fs-helper-missing`），不会静默跳过 —— 这是设计上的 fail closed，不是"已经交付了完整能力"。
- 原始 `app.asar` 不在这台机器上，`npm run extract:asar` 现在会 ENOENT；
  `npm run recover:source` 会拒绝覆盖已有 `src/`（退出码 4），因为工具产的是裸恢复，
  而仓库带的是审过的版本。细节见 `docs/SOURCE-RECOVERY.md` §4 与 §7。
- 打包：**本轮之前仓库里没有任何打包能力** —— `package.json` 的 `build.extraResources` 指向不存在的
  `vendor/fs-helper`，`electron-builder` 不在依赖里，也没有 `dist` 脚本。这一条正在下一轮处理，
  在那之前不要把"仓库能打出安装包"当成事实。
- Windows 上没有 POSIX 权限位，`%APPDATA%` 在本机还带着外来组的继承读权限，
  所以 Agent 令牌的"0600"是代码的请求而不是系统给的保证 —— 登记在 `agent/README.md`。
- 代码里有 26 处按名字引用四份**没能随产物救出来**的评审/手册文档
  （`docs/SECURITY-REVIEW.md`、`docs/PRODUCT-REVIEW.md`、`docs/SOURCE-REVIEW.md`、`docs/RUNBOOK.md`）。
  每条的实质内容就在紧邻它的那几行注释里；逐条登记与 S-01…S-07 的汇总见
  [`docs/SOURCE-RECOVERY.md`](./docs/SOURCE-RECOVERY.md) §6 与 §7。本仓库**没有**伪造这四份文档。
- 不联网、不上传，也意味着**没有**云端结果、没有账户同步、没有后台更新检查。界面上没有的东西，
  文档里也不会写成有。

## 许可

UNLICENSED（`package.json`），本机个人工具。
