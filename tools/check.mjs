#!/usr/bin/env node
// 静态完整性检查：这棵树是从 0.2.0-beta.6 的安装产物里救出来的，
// 所以第一要务不是"功能对不对"，而是"有没有引用到不存在的东西"。
// 任何一条不成立就非零退出，并逐条列出原因。
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', '.data', 'dist', 'release'].includes(e.name)) walk(p, out); }
    else out.push(p);
  }
  return out;
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// 1) 入口与脚本引用的文件必须真的在
if (pkg.main && !existsSync(path.join(ROOT, pkg.main))) failures.push(`package.json main 指向不存在的文件：${pkg.main}`);
for (const [name, command] of Object.entries(pkg.scripts || {})) {
  for (const m of command.matchAll(/node\s+(?:--[\w=-]+\s+)*([\w./\\-]+\.(?:mjs|cjs|js))/g)) {
    const target = path.join(ROOT, m[1]);
    if (!existsSync(target)) failures.push(`scripts.${name} 引用不存在的脚本：${m[1]}`);
  }
}

// 2) 源码里每个相对 import/require 都要能解析。
// 只认"行首的导入语句"：recover-source.mjs 把 `import ... from "./storage.js"` 当作
// 要写进 src/main 的生成内容存在字符串数组里，按全局正则匹配会把数据当引用（假阳性）。
const SPEC = /^[ \t]*(?:import\s[^\n]*?from|export\s[^\n]*?from|await\s+import|import)\s*\(?['"]([^'"]+)['"]/gm;
const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'agent')), ...walk(path.join(ROOT, 'tools'))]
  .filter((f) => /\.(mjs|cjs|js)$/.test(f));
let checkedSpecifiers = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(SPEC)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    checkedSpecifiers++;
    const base = path.resolve(path.dirname(file), spec);
    const ok = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs')]
      .some((c) => { try { return statSync(c).isFile(); } catch { return false; } });
    if (!ok) failures.push(`${rel(file)} 引用了解析不到的模块：${spec}`);
  }
}
notes.push(`相对模块引用 ${checkedSpecifiers} 处全部可解析（扫描 ${files.length} 个 js 文件）`);

// 3) 界面 HTML 引用的脚本与样式必须在
for (const html of walk(ROOT).filter((f) => f.endsWith('.html'))) {
  const text = readFileSync(html, 'utf8');
  for (const m of text.matchAll(/(?:src|href)=["'](\.?\/[^"']+)["']/g)) {
    const spec = m[1];
    if (/^https?:/.test(spec) || spec.startsWith('data:')) continue;
    const target = path.resolve(path.dirname(html), spec.replace(/^\//, './'));
    if (!existsSync(target)) failures.push(`${rel(html)} 引用了不存在的资源：${spec}`);
  }
}

// 4) PowerShell provider 是真实能力来源，缺一个就说明恢复不完整
const providerDir = path.join(ROOT, 'scripts', 'providers');
const EXPECTED = ['software-inventory.ps1', 'software-remove-appx.ps1', 'startup-inventory.ps1', 'startup-action.ps1', 'aggressive-maintenance.ps1'];
for (const p of EXPECTED) {
  if (!existsSync(path.join(providerDir, p))) failures.push(`provider 脚本缺失：scripts/providers/${p}`);
}

// 5) Agent 工具面必须自洽（名字前缀、schema、risk、handler 齐全）
try {
  const mod = await import(pathToFileURL(path.join(ROOT, 'agent', 'tools.mjs')).href);
  const tools = mod.tools || [];
  if (!tools.length) failures.push('agent/tools.mjs 没有导出任何工具');
  for (const t of tools) {
    if (!t.name?.startsWith('jingjie.')) failures.push(`工具名没用 jingjie. 前缀：${t.name}`);
    if (!t.input_schema?.type) failures.push(`工具缺 input_schema：${t.name}`);
    if (!['read', 'write', 'exec'].includes(t.risk)) failures.push(`工具 risk 非法：${t.name}=${t.risk}`);
    if (typeof t.handler !== 'function') failures.push(`工具没有 handler：${t.name}`);
    if (t.risk === 'exec' && !Object.keys(t.input_schema?.properties || {}).includes('confirm')) failures.push(`exec 工具缺 confirm 入参：${t.name}`);
  }
  notes.push(`agent 工具 ${tools.length} 个，声明完整`);
} catch (e) { failures.push(`agent/tools.mjs 载入失败：${e.message}`); }

process.stdout.write(`竞界 静态完整性检查\n`);
for (const n of notes) process.stdout.write(`  · ${n}\n`);
for (const f of failures) process.stdout.write(`  ✗ ${f}\n`);
process.stdout.write(failures.length ? `\n${failures.length} 项不通过\n` : '\n全部通过\n');
process.exit(failures.length ? 1 : 0);
