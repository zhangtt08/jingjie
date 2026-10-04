# jingjie (净界) Agent API

把净界的能力暴露成带 schema 的工具，让任意 Agent（Tcode / Claude Code / Codex / 任何 MCP 客户端）
不需要读源码、不需要猜路由就能调用。契约见
`../../personal-agent-hub/docs/AGENT_API_STANDARD.md`，端口表里净界那一格是 **8796**。

服务只监听 `127.0.0.1`，并且**只接受打给本机回环的请求**：见下面[本机守卫](#本机守卫必装)。

## 启动

```bash
npm run agent:serve      # = node agent/serve.mjs，起在 8796（被占时按契约自动 +1 并写 agent/.endpoint）
npm run agent:mcp        # MCP stdio 桥；服务没在跑时按 agent/launch.json 自动拉起
```

> MCP 客户端请直接 spawn `node agent/mcp-server.mjs`（标准契约就是这么写的）。
> 用 `npm run agent:mcp` 时 npm 会往 stdout 前置两行横幅（`> jingjie@0.2.0 agent:mcp` 与命令行本身），
> 严格的 JSON-lines 读取器要加 `--silent`，否则前两行不是 JSON。桥自己的输出全走 stderr。

等价写法：`JINGJIE_AGENT_PORT=8796 node agent/serve.mjs`，或 `AGENT_PORT=8796 node agent/server.mjs`。
（`serve.mjs` 认的端口变量按 `JINGJIE_AGENT_PORT` → `AGENT_PORT` → `PORT` → 8796 取第一个。）

> `agent/server.mjs` 与 `agent/mcp-server.mjs` 的**模板**来自
> `personal-agent-hub/templates/agent-api/node/`。**本项目在它们上面装了本机守卫**
> （`agent/local-guard.mjs` + `agent/token-store.mjs`），所以这两份不再是逐字节副本 ——
> 模板原本每条响应都带 `access-control-allow-origin: *`、OPTIONS 无条件应答、非 GET 没有任何鉴权，
> 而这里的 `jingjie.plan_execute` 带 `confirm:true` 就真删文件、真卸载、真改启动项。
> 模板里「未知工具分支必须先回完再 return」那条修复原样保留（动了会让它回归）。

四个契约端点：

```
GET  /api/health          -> {ok:true,data:{project,version,agent_api:1,tools,uptime_ms,guard:{…}}}
GET  /api/agent/tools     -> {ok:true,data:[{name,description,input_schema,risk}]}
GET  /api/agent/manifest  -> {ok:true,data:{project,version,base_url,tools,api:{token_header,token_env,token_file}}}
POST /api/agent/tool      -> body {tool,input} -> {ok:true,tool,ms,data} | {ok:false,error:{code,message}}
```

## 本机守卫（必装）

判据形状抄自本组合已提交的参考实现 `Desktop/项目/frameboost/electron/local-guard.ts`，
实现是 `agent/local-guard.mjs`。**"只监听 127.0.0.1"不是边界**：本机任意进程、
以及浏览器里任意一个网页都能把请求打到这个端口，而请求体里的 `confirm:true` 是页面自己就能写的值。
所以四道闸在业务分支之前逐个判，任何一道不过就回 JSON 错误码，绝不"记一行日志继续跑"：

| 闸 | 判据 | 拒绝码 |
| --- | --- | --- |
| 绑定 | 只准绑 `127.0.0.1`/`localhost`/`::1`；`start({host:'0.0.0.0'})` 直接抛，服务不起来了事 | — |
| Host | 必须逐字等于 `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`（`<port>` 是本进程实际监听的端口） | 403 `HOST_NOT_ALLOWED` |
| Origin / Referer | 没带 = 放行（curl / node / MCP 桥都不带）；带了就必须落在本机回环上。**永不拿 Origin 去比请求自己的 Host** —— 那正是 DNS rebinding 的洞（域名解析到 127.0.0.1 后两者自然相等） | 403 `ORIGIN_NOT_ALLOWED` / `REFERER_NOT_ALLOWED` |
| 令牌 | 非 GET/HEAD 必须带 `x-jingjie-token: <token>`，或等价的 `Authorization: Bearer <token>`；定长时间比较 | 401 `TOKEN_REQUIRED` |
| CORS | 任何响应都不发 `access-control-allow-origin: *`；`OPTIONS` 也先过守卫，不带令牌 401、带令牌 405，一次跨源放行都不给 | — |

`test/agent-guard.test.js` 与 `npm run selftest` 把这五道各钉了一条会红的断言。

### 令牌：自动生成、落盘 0600、合法调用方零配置

`agent/token-store.mjs` 在**服务启动时**取令牌：有就用、没有就生成 32 字节随机值并落盘。
MCP 桥与净界桌面壳读的是同一份文件，用户不需要设任何环境变量 ——
要用户先设，结果只有两种：没人设（守卫只能退化成"没令牌也行"，边界又没了），或者每换一个终端都要重设。

落盘位置按优先级：

1. `JINGJIE_AGENT_TOKEN` / `AGENT_API_TOKEN` 环境变量（显式指定，最高优先，不写文件）；
2. `$JINGJIE_APP_DATA_DIR/agent-api.token`（测试与"别动用户真实 AppData"的场景用它指到临时目录）；
3. `%APPDATA%\jingjie\agent-api.token` —— 与界面账本同一个每用户目录（`src/main/index.js` 的
   `app.getPath('userData')`、`jingjie.history` 的只读来源都是它，一份判据不分叉）；
4. 非 Windows / 没有 APPDATA 时回落 `os.homedir()/.jingjie`。

写文件用独占创建 + `chmod 0600`。**如实说明 Windows 的那一半**：NTFS 没有 POSIX 权限位，
libuv 把可写文件一律报成 `0666`，`chmod` 只映射只读位，所以"0600"在这台机器上只是代码的请求，
不是系统给的保证；真正的隔离靠 `%APPDATA%` 是每用户目录这一层。本机实测
`icacls %APPDATA%` 除本用户/SYSTEM/Administrators 外还带 `CodexSandboxUsers` 与一个外来 SID 的
继承 `RX`，即这台机器上本机其他账号读得到这个令牌文件 —— 这是已登记的残留，
不构成"网页可以调用"（那仍然被 Host/Origin/令牌三道挡住），要收紧请改目录或设
`JINGJIE_AGENT_TOKEN`。取不到令牌时服务**拒绝启动**，不会以"写接口没有守卫"的状态监听。

```bash
# 自己看令牌在哪、守卫开没开（GET 不要令牌）
curl -s http://127.0.0.1:8796/api/health | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).data.guard))"
# Windows PowerShell 里读令牌再打一发 POST
$t = Get-Content "$env:APPDATA\jingjie\agent-api.token" -Raw
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8796/api/agent/tool" `
  -Headers @{ 'x-jingjie-token' = $t.Trim() } -ContentType 'application/json' `
  -Body '{"tool":"jingjie.env_probe","input":{"powerShellProbe":false,"providerCheck":false}}'
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

- **调用侧**：上面的[本机守卫](#本机守卫必装) —— 动系统的那把刀要同时过两道独立的门：
  HTTP 层的本机令牌 + 工具层的 `confirm:true`。少任何一道都不执行。
- 提供者脚本会动系统，所以这个工具面的常态是**扫描 / 清单 / 预览**。执行类工具的存在不等于被跑过。
- 只读工具不会写用户的真实 AppData：控制器注入的 `dataRoot` 默认是仓库内 `.data/agent`（已在 `.gitignore` 里），
  `%APPDATA%\jingjie` 只被 `jingjie.history` 读、从不写；该目录里由 Agent 写的只有 `agent-api.token`。
- 所有路径判定复用 `src/main/path-guard.js`：受保护根目录（桌面/文档/下载/图片/视频等）与
  `environmentIsSafe` 在每次扫描与删除前重新检查（符号链接/realpath 二次核），Agent 层不另立第二套规则。
- PowerShell 解释器按 `%SystemRoot%` 解析（不查 PATH），provider 脚本每次调用前重新验证
  不是再解析点、真实路径仍在 providerRoot 里（`src/main/powershell-runner.js` S-06/S-07）。
- IPC 与工具入参都是 id-only 的严格形状（`src/main/request-validators.js`、`tools.mjs` 的
  `requirePlanId`/`requireSelection`）；提权调用一律 `shell:false` 且带超时（`src/main/elevation.js`）。
  这四件是评审点名的安全核心，本机守卫叠在它们之上，没有替换其中任何一件。
- fs-helper（原生删除守卫二进制）不在版本库里。找不到时 `env_probe.fsHelperAvailable=false`，
  扩展清理与提权动作按设计 fail closed 报 `fs-helper-missing`，不会绕过守卫静默跳过。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `AGENT_PORT` / `PORT` | 覆盖端口（`serve.mjs` 的取法：`JINGJIE_AGENT_PORT` → `AGENT_PORT` → `PORT` → 8796） |
| `JINGJIE_AGENT_PORT` | 上面的第一顺位 |
| `AGENT_BASE_URL` | MCP 桥直接连到指定地址，跳过 `.endpoint` 与自动拉起 |
| `JINGJIE_AGENT_TOKEN` / `AGENT_API_TOKEN` | 显式指定本机令牌（不写文件）；缺省时令牌自动生成并落盘，见[令牌](#令牌自动生成落盘-0600合法调用方零配置) |
| `JINGJIE_DATA_ROOT` | 账本/隔离区写入位置，默认 `<repo>/.data/agent` |
| `JINGJIE_APP_DATA_DIR` | 每用户目录：令牌文件的所在处，也是 `jingjie.history` 读界面账本的来源（默认 `%APPDATA%\jingjie`） |
| `JINGJIE_PROVIDERS_DIR` | 覆盖 provider 脚本目录（默认 `<repo>/scripts/providers`） |
| `JINGJIE_FS_HELPER` | 指定 fs-helper 二进制路径 |

## 自检

下面每条都在本机（Git Bash + Windows）实际跑过。POST 要带令牌，令牌在服务起来后才有，
所以顺序是：起服务 → 读令牌 → 打端点。

```bash
npm run agent:serve &      # 或另开一个终端
TOKEN=$(cat "$APPDATA/jingjie/agent-api.token" | tr -d '\r\n')

curl -s http://127.0.0.1:8796/api/health            # GET 不要令牌，data.guard 里能看到守卫形状
curl -s http://127.0.0.1:8796/api/agent/tools
curl -s -X POST http://127.0.0.1:8796/api/agent/tool -H 'content-type: application/json' \
  -H "x-jingjie-token: $TOKEN" \
  -d '{"tool":"jingjie.env_probe","input":{"powerShellProbe":false,"providerCheck":false}}'

# 没有令牌的 POST 必须被拒（回 401 TOKEN_REQUIRED 就是守卫在位）
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8796/api/agent/tool \
  -H 'content-type: application/json' -d '{"tool":"jingjie.env_probe","input":{}}'

# MCP 三条管道（initialize / tools/list / tools/call 都要有 JSON-RPC 响应；桥自己读令牌）
printf '%s\n%s\n%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"jingjie.env_probe","arguments":{"powerShellProbe":false,"providerCheck":false}}}' \
 | node agent/mcp-server.mjs
```

仓库自带的两道门把上面的东西固化成了会红的断言：

```bash
npm run selftest           # 契约 + 五道守卫（伪造 Host / 跨源 Origin / 缺令牌 / 无通配 CORS / 零配置令牌）
npm test                   # test/agent-guard.test.js 是那五道的靶子
```

> 生态统一验收（在 personal-agent-hub 里跑 `npm run verify:agent-apis -- --only=jingjie`）
> 现在打的是**只读** GET 端点，不需要令牌；任何写请求都要带 `x-jingjie-token`，
> 那份脚本要扩到写端点得先读 `%APPDATA%\jingjie\agent-api.token`。这一条尚未在那边落实。

失败形状：缺必填参数与未知参数都是 `bad_input`（HTTP 400）；未注册工具是
`unknown_tool` 且带 `available` 数组；执行类未确认是 `needs_confirmation`；
被本机守卫拒掉的是 `HOST_NOT_ALLOWED` / `ORIGIN_NOT_ALLOWED` / `REFERER_NOT_ALLOWED`（403）
与 `TOKEN_REQUIRED`（401）。

## Windows 注意

控制台是 GBK：PowerShell 探测结果用 base64 回传再在 Node 侧解码，避免中文产品名把 JSON 打乱。
启动日志与工具返回给终端看时不要指望中文对齐。
