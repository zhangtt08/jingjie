#!/usr/bin/env node
// 运行时冒烟：证明"这棵救出来的源码树"对应的本机运行环境仍然可用。
// 只读 —— 不装东西、不删东西、不动系统。
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse((await import('node:fs')).readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RUNTIME = path.resolve(ROOT, '..', '..', '竞界-安装包');

const out = [];
const check = (name, ok, detail = '') => out.push({ name, ok, detail });

// 1) 打包运行时（提供 Electron 与 app.asar 的那份）还在不在
check('安装包运行时目录存在', existsSync(RUNTIME), RUNTIME);
const exe = path.join(RUNTIME, 'JingJie.exe');
check('可执行文件在位', existsSync(exe), exe);
const asar = path.join(RUNTIME, 'resources', 'app.asar');
check('app.asar 在位（源码即从这里救出）', existsSync(asar), asar);

// 2) Electron 依赖是否装了（没装就明确说怎么装，别让人以为软件坏了）
const electronDir = path.join(ROOT, 'node_modules', 'electron');
check('electron 已安装（npm run start 的前提）', existsSync(electronDir), existsSync(electronDir) ? '' : '先跑 npm install');

// 3) provider 脚本齐全（真实能力来源）
const providerDir = path.join(ROOT, 'scripts', 'providers');
const scripts = existsSync(providerDir) ? readdirSync(providerDir).filter((f) => f.endsWith('.ps1')) : [];
check('provider 脚本 5 份齐全', scripts.length >= 5, scripts.join(', '));

// 4) PowerShell 真的能跑：做一次只读的软件清单计数
try {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(providerDir, 'software-inventory.ps1')],
    { maxBuffer: 64 * 1024 * 1024, timeout: 180000, windowsHide: true });
  const parsed = JSON.parse(stdout);
  const count = Array.isArray(parsed) ? parsed.length : (parsed?.items?.length ?? parsed?.count ?? null);
  check('software-inventory.ps1 真跑出结果', count != null, `条目 ${count}`);
} catch (e) {
  check('software-inventory.ps1 真跑出结果', false, String(e.message).slice(0, 160));
}

process.stdout.write(`竞界 运行时冒烟（package ${pkg.version}）\n`);
for (const r of out) process.stdout.write(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? (r.detail ? ` :: ${r.detail}` : '') : ` :: ${r.detail}`}\n`);
const bad = out.filter((r) => !r.ok).length;
process.stdout.write(`\n${out.length - bad}/${out.length} 通过\n`);
process.exit(bad ? 1 : 0);
