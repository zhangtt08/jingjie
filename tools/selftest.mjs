#!/usr/bin/env node
// Agent 契约运行时自检：起真服务、打真端点、验真回执，然后关掉。
// 只看 README 不算验收 —— 这个脚本失败就说明接口是坏的。
//
// 本机守卫（agent/local-guard.mjs）之后，合法调用方也必须走同一条路：
// 令牌由服务端启动时自动生成并落盘，本脚本与 MCP 桥都按同一份判据读它 ——
// 所以这里既验契约，也验"守卫确实在起作用"（不带令牌 / 伪造 Host / 跨源 Origin 都要被拒）。
// 全程用仓库内 .data 下的临时目录，不碰用户真实的 %APPDATA%\jingjie。
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { jingjieAppDataDir, readAgentToken } from '../agent/token-store.mjs';
import { DEFAULT_TOKEN_HEADER } from '../agent/local-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 4000);
const APP_DATA = path.join(ROOT, '.data', 'selftest-appdata');
const DATA_ROOT = path.join(ROOT, '.data', 'selftest-data');
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const childEnv = { ...process.env, AGENT_PORT: String(PORT), JINGJIE_APP_DATA_DIR: APP_DATA, JINGJIE_DATA_ROOT: DATA_ROOT };

function killTree(child) {
  if (!child?.pid) return;
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch { try { child.kill(); } catch { /* 已退 */ } }
}

/**
 * 直接写 socket 发一个**指定 Host 头**的请求。
 * 为什么不用 fetch：undici 按 URL 自己算 Host，不接受调用方伪造的 Host ——
 * 而"伪造 Host"正是这条守卫要挡的那一类请求，只能绕开客户端库自己发。
 */
function rawRequest({ hostHeader, method = 'GET', path: p = '/api/health', headers = {}, body = null, port }) {
  if (!port) throw new Error('rawRequest 必须显式给端口：服务被占时按契约 +1，用 PORT 会打到别的进程上');
  return new Promise((resolve, reject) => {
    const conn = createConnection({ host: '127.0.0.1', port }, () => {
      const lines = [`${method} ${p} HTTP/1.1`, `Host: ${hostHeader}`, 'Connection: close'];
      const all = { ...headers };
      if (body !== null) { all['content-type'] = 'application/json'; all['content-length'] = Buffer.byteLength(body); }
      for (const [k, v] of Object.entries(all)) lines.push(`${k}: ${v}`);
      conn.end([...lines, '', body ?? ''].join('\r\n'));
    });
    let raw = '';
    conn.setEncoding('utf8');
    conn.on('data', (d) => { raw += d; });
    conn.on('end', () => {
      const split = raw.indexOf('\r\n\r\n');
      const head = split >= 0 ? raw.slice(0, split) : raw;
      const text = split >= 0 ? raw.slice(split + 4) : '';
      resolve({
        status: Number(/HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0),
        headers: head,
        text,
        json: (() => { try { return JSON.parse(text); } catch { return null; } })()
      });
    });
    conn.on('error', reject);
    conn.setTimeout(15000, () => { conn.destroy(); reject(new Error('raw request 超时')); });
  });
}

try { rmSync(APP_DATA, { recursive: true, force: true }); } catch { /* 忽略 */ }
try { rmSync(DATA_ROOT, { recursive: true, force: true }); } catch { /* 忽略 */ }
try { rmSync(path.join(ROOT, 'agent', '.endpoint'), { force: true }); } catch { /* 忽略 */ }

const child = spawn(process.execPath, [path.join(ROOT, 'agent', 'serve.mjs')], {
  cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
});
const log = [];
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));

let base = null;
for (let i = 0; i < 60 && !base; i++) {
  await sleep(500);
  for (const candidate of [existsSync(path.join(ROOT, 'agent', '.endpoint')) ? readFileSync(path.join(ROOT, 'agent', '.endpoint'), 'utf8').trim() : null, `http://127.0.0.1:${PORT}`].filter(Boolean)) {
    try { const r = await fetch(`${candidate}/api/health`, { signal: AbortSignal.timeout(1500) }); if (r.ok) { base = candidate; break; } } catch { /* 未就绪 */ }
  }
}
if (!base) {
  check('服务启动', false, log.join('').slice(0, 300));
} else {
  const realPort = Number(new URL(base).port) || PORT;
  // 令牌：服务端自动生成并落盘 0600，这里按合法调用方的读法读出来（用户不需要设任何东西）
  const token = readAgentToken(childEnv);
  const tokenFile = path.join(jingjieAppDataDir(childEnv), 'agent-api.token');
  check('本机令牌自动生成并落盘（合法调用方零配置读得到）', token.length >= 32 && existsSync(tokenFile), `${tokenFile.slice(-40)} · ${token ? '读到' : '读不到'}`);
  const auth = () => ({ 'content-type': 'application/json', [DEFAULT_TOKEN_HEADER]: token });
  const post = (body, headers = auth()) => fetch(`${base}/api/agent/tool`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });

  const healthRes = await fetch(`${base}/api/health`);
  const health = await healthRes.json();
  check('GET /api/health 形状符合契约', health.ok === true && !!health.data?.project, JSON.stringify(health.data).slice(0, 80));
  check('响应不再带通配 CORS 头', !/access-control-allow-origin:\s*\*/i.test([...healthRes.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')), [...healthRes.headers.entries()].map(([k, v]) => `${k}: ${v}`).join(' | ').slice(0, 160));

  const listed = await (await fetch(`${base}/api/agent/tools`)).json();
  const tools = listed.data || [];
  check('GET /api/agent/tools 返回带 schema 的清单', Array.isArray(tools) && tools.length >= 4 && tools.every((t) => t.name?.startsWith('jingjie.') && t.input_schema?.type && t.risk), `${tools.length} 个`);

  const unknown = await (await post({ tool: 'jingjie.__nope__', input: {} })).json();
  check('未知工具回 unknown_tool 且带 available 数组', unknown.ok === false && unknown.error?.code === 'unknown_tool' && Array.isArray(unknown.error?.available), `available=${(unknown.error?.available || []).length}`);

  const needsInput = tools.find((t) => (t.input_schema?.required || []).length > 0);
  if (needsInput) {
    const bad = await (await post({ tool: needsInput.name, input: {} })).json();
    check('缺必填参数回 bad_input（证明校验真的接上）', bad.ok === false && bad.error?.code === 'bad_input', `${needsInput.name} → ${bad.error?.code}`);
  }

  const execTool = tools.find((t) => t.risk === 'exec');
  if (execTool) {
    const noConfirm = await (await post({ tool: execTool.name, input: { confirm: false } })).json();
    // 真回执长这样：{executed:false, reason:"needs-confirmation", planId:…}
    // 判据是"没动系统"，不是"必须报错" —— 返回计划本身是设计行为。
    const untouched = noConfirm.ok === true && noConfirm.data?.executed === false;
    check(`exec 工具 ${execTool.name} 不带 confirm 时不动系统`, untouched, JSON.stringify(noConfirm.data || noConfirm).slice(0, 160));
    check(`exec 工具 ${execTool.name} 没有把执行记录写进账本`, !existsSync(path.join(DATA_ROOT, 'plan-history.json')), path.join(DATA_ROOT, 'plan-history.json'));
  } else check('存在 exec 工具', false, '一个都没有，说明能力没接完');

  const readTool = tools.find((t) => t.risk === 'read' && !(t.input_schema?.required || []).length);
  if (readTool) {
    const real = await (await post({ tool: readTool.name, input: { powerShellProbe: false, providerCheck: false } })).json();
    check(`只读工具 ${readTool.name} 返回本机真实数据`, real.ok === true && real.data != null, JSON.stringify(real.data).slice(0, 120));
  }

  // --- 守卫：三种越界形状都要被拒，而且要拒在业务分支之前 ---
  const noToken = await post({ tool: 'jingjie.env_probe', input: {} }, { 'content-type': 'application/json' });
  const noTokenBody = await noToken.json().catch(() => ({}));
  check('不带令牌的 POST 被拒（401 TOKEN_REQUIRED）', noToken.status === 401 && noTokenBody?.error?.code === 'TOKEN_REQUIRED', `${noToken.status} ${noTokenBody?.error?.code}`);

  const evilOrigin = await post({ tool: 'jingjie.env_probe', input: {} }, { 'content-type': 'application/json', [DEFAULT_TOKEN_HEADER]: token, origin: 'https://evil.example.com' });
  const evilOriginBody = await evilOrigin.json().catch(() => {});
  check('跨源 Origin 的 POST 被拒（403 ORIGIN_NOT_ALLOWED）', evilOrigin.status === 403 && evilOriginBody?.error?.code === 'ORIGIN_NOT_ALLOWED', `${evilOrigin.status} ${evilOriginBody?.error?.code}`);

  const forged = await rawRequest({ port: realPort, hostHeader: `evil.example.com:${realPort}`, method: 'POST', path: '/api/agent/tool', headers: { [DEFAULT_TOKEN_HEADER]: token, origin: `http://evil.example.com:${realPort}` }, body: '{"tool":"jingjie.env_probe","input":{}}' });
  // Origin 与请求自己的 Host 相同也仍然要拒：那正是 DNS rebinding 的形状
  check('伪造 Host 的请求被拒（403 HOST_NOT_ALLOWED，Origin 与 Host 相同也不放行）', forged.status === 403 && /HOST_NOT_ALLOWED/.test(forged.text), `${forged.status} ${forged.text.slice(0, 90)}`);

  const preflight = await rawRequest({ port: realPort, hostHeader: `127.0.0.1:${realPort}`, method: 'OPTIONS', path: '/api/agent/tool' });
  check('预检不再拿到通配 CORS 放行', !/access-control-allow-origin/i.test(preflight.headers), `${preflight.status} ${preflight.headers.split('\r\n').slice(0, 6).join(' | ').slice(0, 140)}`);

  // MCP stdio 握手（桥自己读令牌，用户没有一步要配）
  const { spawnSync } = await import('node:child_process');
  const stdin = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"jingjie.env_probe","arguments":{"powerShellProbe":false,"providerCheck":false}}}'
  ].join('\n') + '\n';
  const mcp = spawnSync(process.execPath, [path.join(ROOT, 'agent', 'mcp-server.mjs')], {
    cwd: ROOT, input: stdin, encoding: 'utf8', env: childEnv, timeout: 60000,
  });
  const lines = String(mcp.stdout || '').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = lines.find((l) => l.id === 1);
  const list = lines.find((l) => l.id === 2);
  const call = lines.find((l) => l.id === 3);
  check('MCP initialize 与 tools/list 都有响应且数量一致', !!init?.result?.serverInfo && Array.isArray(list?.result?.tools) && list.result.tools.length === tools.length, `mcp=${list?.result?.tools?.length ?? 0} http=${tools.length}`);
  check('MCP tools/call 带着自动读到的令牌打通（合法路径零配置）', call?.result?.isError === false && /"project"/.test(String(call?.result?.content?.[0]?.text ?? '')), String(call?.result?.content?.[0]?.text ?? JSON.stringify(call?.error ?? '')).slice(0, 120));

  killTree(child);
}

rmSync(APP_DATA, { recursive: true, force: true });
rmSync(DATA_ROOT, { recursive: true, force: true });

process.stdout.write('竞界 Agent 契约自检\n');
for (const r of results) process.stdout.write(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' :: ' + r.detail}\n`);
const bad = results.filter((r) => !r.ok).length;
process.stdout.write(`\n${results.length - bad}/${results.length} 通过\n`);
process.exit(bad ? 1 : 0);
