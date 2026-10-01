#!/usr/bin/env node
// Agent 契约运行时自检：起真服务、打真端点、验真回执，然后关掉。
// 只看 README 不算验收 —— 这个脚本失败就说明接口是坏的。
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 4000);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

function killTree(child) {
  if (!child?.pid) return;
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch { try { child.kill(); } catch { /* 已退 */ } }
}

try { rmSync(path.join(ROOT, 'agent', '.endpoint'), { force: true }); } catch { /* 忽略 */ }

const child = spawn(process.execPath, [path.join(ROOT, 'agent', 'serve.mjs')], {
  cwd: ROOT, env: { ...process.env, AGENT_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
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
  const health = await (await fetch(`${base}/api/health`)).json();
  check('GET /api/health 形状符合契约', health.ok === true && !!health.data?.project, JSON.stringify(health.data).slice(0, 80));

  const listed = await (await fetch(`${base}/api/agent/tools`)).json();
  const tools = listed.data || [];
  check('GET /api/agent/tools 返回带 schema 的清单', Array.isArray(tools) && tools.length >= 4 && tools.every((t) => t.name?.startsWith('jingjie.') && t.input_schema?.type && t.risk), `${tools.length} 个`);

  const unknown = await (await fetch(`${base}/api/agent/tool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'jingjie.__nope__', input: {} }) })).json();
  check('未知工具回 unknown_tool 且带 available 数组', unknown.ok === false && unknown.error?.code === 'unknown_tool' && Array.isArray(unknown.error?.available), `available=${(unknown.error?.available || []).length}`);

  const needsInput = tools.find((t) => (t.input_schema?.required || []).length > 0);
  if (needsInput) {
    const bad = await (await fetch(`${base}/api/agent/tool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: needsInput.name, input: {} }) })).json();
    check('缺必填参数回 bad_input（证明校验真的接上）', bad.ok === false && bad.error?.code === 'bad_input', `${needsInput.name} → ${bad.error?.code}`);
  }

  const execTool = tools.find((t) => t.risk === 'exec');
  if (execTool) {
    const noConfirm = await (await fetch(`${base}/api/agent/tool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: execTool.name, input: { confirm: false } }) })).json();
    // 真回执长这样：{executed:false, reason:"needs-confirmation", planId:…}
    // 判据是"没动系统"，不是"必须报错" —— 返回计划本身是设计行为。
    const untouched = noConfirm.ok === true && noConfirm.data?.executed === false;
    check(`exec 工具 ${execTool.name} 不带 confirm 时不动系统`, untouched, JSON.stringify(noConfirm.data || noConfirm).slice(0, 160));
  } else check('存在 exec 工具', false, '一个都没有，说明能力没接完');

  const readTool = tools.find((t) => t.risk === 'read' && !(t.input_schema?.required || []).length);
  if (readTool) {
    const real = await (await fetch(`${base}/api/agent/tool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: readTool.name, input: {} }) })).json();
    check(`只读工具 ${readTool.name} 返回本机真实数据`, real.ok === true && real.data != null, JSON.stringify(real.data).slice(0, 120));
  }

  // MCP stdio 握手
  const { spawnSync } = await import('node:child_process');
  const stdin = ['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}', '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'].join('\n') + '\n';
  const mcp = spawnSync(process.execPath, [path.join(ROOT, 'agent', 'mcp-server.mjs')], {
    cwd: ROOT, input: stdin, encoding: 'utf8', env: { ...process.env, AGENT_BASE_URL: base }, timeout: 30000,
  });
  const lines = String(mcp.stdout || '').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = lines.find((l) => l.id === 1);
  const list = lines.find((l) => l.id === 2);
  check('MCP initialize 与 tools/list 都有响应且数量一致', !!init?.result?.serverInfo && Array.isArray(list?.result?.tools) && list.result.tools.length === tools.length, `mcp=${list?.result?.tools?.length ?? 0} http=${tools.length}`);

  killTree(child);
}

process.stdout.write('竞界 Agent 契约自检\n');
for (const r of results) process.stdout.write(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' :: ' + r.detail}\n`);
const bad = results.filter((r) => !r.ok).length;
process.stdout.write(`\n${results.length - bad}/${results.length} 通过\n`);
process.exit(bad ? 1 : 0);
