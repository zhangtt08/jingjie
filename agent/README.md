# jingjie (净界) Agent API

把净界的能力暴露成带 schema 的工具，让任意 Agent（Tcode / Claude Code / Codex / 任何 MCP 客户端）
不需要读源码、不需要猜路由就能调用。契约见
`../../personal-agent-hub/docs/AGENT_API_STANDARD.md`，端口表里净界那一格是 **8796**。

服务只监听 `127.0.0.1`。

## 启动

```bash
npm run agent:serve      # = node agent/serve.mjs，起在 8796（被占时按契约自动 +1 并写 agent/.endpoint）
npm run agent:mcp        # MCP stdio 桥；服务没在跑时按 agent/launch.json 自动拉起
```

等价写法：`AGENT_PORT=8796 node agent/server.mjs`。

> `agent/server.mjs` 与 `agent/mcp-server.mjs` 是从
> `personal-agent-hub/templates/agent-api/node/` **逐字节复制**的标准实现，不要改逻辑
> （模板修过一次「未知工具分支必须 return」的缺陷，改动会让它回归）。
> `agent/serve.mjs` 只有一件事：把标准 `start()` 的端口固定成 8796 —— 因为模板的兜底端口是 8790，
> 而 `launch.json` 的 `ready_port` 必须是 8796，MCP 桥才会从 8796 起探测。
> 所以 `launch.json` 的 args 指向 `agent/serve.mjs` 而不是 `agent/server.mjs`：
> 后者会起在 8790，桥在 8796..8807 探测 30 秒后报超时。

四个契约端点：

```
GET  /api/health          -> {ok:true,data:{project,version,agent_api:1,tools,uptime_ms}}
GET  /api/agent/tools     -> {ok:true,data:[{name,description,input_schema,risk}]}
GET  /api/agent/manifest  -> {ok:true,data:{project,version,base_url,tools}}
POST /api/agent/tool      -> body {tool,input} -> {ok:true,tool,ms,data} | {ok:false,error:{code,message}}
```

## 工具清单（8 个：7 read + 1 exec）

全部调用项目真实模块：`src/main/services.js`（不依赖 Electron 的 composition root）造出的就是界面
在用的同一批控制器；软件清单与启动项走 `scripts/providers/*.ps1` 的真实 PowerShell 调用。

| 工具 | risk | 作用 |
| --- | --- | --- |
| `jingjie.env_probe` | read | 真实读本机：OS 版本/内存、**是否管理员**、PowerShell 版本（按 `%SystemRoot%` 解析解释器，不查 PATH）、五个 provider 脚本是否齐全、路径守卫环境是否安全、fs-helper 是否可用 |
| `jingjie.software_inventory` | read | 真实已安装软件清单（注册表 Uninstall 四视图 + Get-AppxPackage）：总数、可标准卸载数、受保护数，支持 `query` / `source` / `onlyUninstallable` 过滤与 `page`/`pageSize` 分页 |
| `jingjie.startup_inventory` | read | 真实登录启动项清单（Run/RunOnce、启动文件夹、非 Microsoft 计划任务），带影响说明与保护判定 |
| `jingjie.plan_build` | read | 把四个分区汇成一份可勾选的计划快照（15 分钟过期），返回分组计数与容量 |
| `jingjie.plan_preview` | read | **dry-run**：给 `sections`（现场建计划）或 `planId`+`selection`，返回将被影响的**绝对路径清单与总大小**。`deletionsExecuted:false`、`writesToDisk:false` —— 这一步不删任何东西 |
| `jingjie.history` | read | 真实历史账本（默认读 `%APPDATA%\jingjie` 里界面写的记录，只读），返回真实条数；某类为空时如实报空并说明什么时候才会有 |
| `jingjie.quarantine_list` | read | 隔离区（7 天可恢复）与启动项 `.reg` 备份清单 |
| `jingjie.plan_execute` | **exec** | 唯一会真实改动本机的工具。`confirm` 是必填参数：`confirm:false` 只返回预览计划、**不执行**；`confirm:true` 才真跑，且只能跑 `plan_preview` 摊开过的条目（未预览的条目被控制器拒成 `preview-required`）。含回收站等不可恢复动作时还要 `acknowledgeIrreversible:true` |

## 安全边界

- 提供者脚本会动系统，所以这个工具面的常态是**扫描 / 清单 / 预览**。执行类工具的存在不等于被跑过。
- 只读工具不会写用户的真实 AppData：控制器注入的 `dataRoot` 默认是仓库内 `.data/agent`（已在 `.gitignore` 里），
  `%APPDATA%\jingjie` 只被 `jingjie.history` 读、从不写。
- 所有路径判定复用 `src/main/path-guard.js`：受保护根目录（桌面/文档/下载/图片/视频等）与
  `environmentIsSafe` 在每次扫描与删除前重新检查，Agent 层不另立第二套规则。
- fs-helper（原生删除守卫二进制）不在版本库里。找不到时 `env_probe.fsHelperAvailable=false`，
  扩展清理与提权动作按设计 fail closed 报 `fs-helper-missing`，不会绕过守卫静默跳过。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `AGENT_PORT` / `PORT` | 覆盖 `agent/server.mjs` 的端口（`serve.mjs` 用的是 `JINGJIE_AGENT_PORT`） |
| `AGENT_BASE_URL` | MCP 桥直接连到指定地址，跳过 `.endpoint` 与自动拉起 |
| `JINGJIE_DATA_ROOT` | 账本/隔离区写入位置，默认 `<repo>/.data/agent` |
| `JINGJIE_APP_DATA_DIR` | 覆盖历史账本的只读来源（默认 `%APPDATA%\jingjie`） |
| `JINGJIE_PROVIDERS_DIR` | 覆盖 provider 脚本目录（默认 `<repo>/scripts/providers`） |
| `JINGJIE_FS_HELPER` | 指定 fs-helper 二进制路径 |

## 自检

```bash
# HTTP 四端点
curl -s http://127.0.0.1:8796/api/health
curl -s http://127.0.0.1:8796/api/agent/tools
curl -s -X POST http://127.0.0.1:8796/api/agent/tool -H 'content-type: application/json' \
  -d '{"tool":"jingjie.env_probe","input":{}}'

# MCP 三条管道（initialize / tools/list / tools/call 都要有 JSON-RPC 响应）
printf '%s\n%s\n%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"jingjie.startup_inventory","arguments":{}}}' \
 | node agent/mcp-server.mjs

# 生态统一验收（在 personal-agent-hub 里）
npm run verify:agent-apis -- --only=jingjie
```

失败形状：缺必填参数与未知参数都是 `bad_input`（HTTP 400）；未注册工具是
`unknown_tool` 且带 `available` 数组；执行类未确认是 `needs_confirmation`。

## Windows 注意

控制台是 GBK：PowerShell 探测结果用 base64 回传再在 Node 侧解码，避免中文产品名把 JSON 打乱。
启动日志与工具返回给终端看时不要指望中文对齐。
