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
const RUNTIME = path.join(ROOT, 'JingJie-runtime');

const out = [];
const check = (name, ok, detail = '') => out.push({ name, ok, detail });

// 1) 打包运行时（提供 Electron 与 fs-helper 的那份）在不在
const exe = path.join(RUNTIME, 'JingJie.exe');
const runtimePresent = existsSync(exe);
check('安装运行时在位（双击即用的那一份）', runtimePresent, exe);
const helper = path.join(RUNTIME, 'resources', 'fs-helper', 'JingJieFsHelper.exe');
check('fs-helper 原生护栏在位（删除时真正兜住保护边界）', existsSync(helper), helper);

// app.asar 是"源码从哪儿来"的历史来源，不是运行前提：源码已经落到 src/ 并入库，
// asar 被抽掉之后仍然能跑，所以缺它只能算信息，不能判失败（判失败等于要求仓库永远背一份二进制）。
const asar = path.join(RUNTIME, 'resources', 'app.asar');
const recoveredSource = existsSync(path.join(ROOT, 'src', 'main', 'index.js'));
if (existsSync(asar)) check('app.asar 在位', true, asar);
else check('app.asar 已不需要（源码已在仓库 src/ 内）', recoveredSource, recoveredSource ? '源码在仓库内，asar 可缺' : '源码也不在，恢复链路断了');

// 2) Electron 只在"用 npm start 跑开发模式"时才是前提；有打包运行时就不需要它
if (runtimePresent) check('electron 依赖（开发模式才需要）', true, '有打包运行时，双击即用，不需要 node_modules/electron');
else check('electron 已安装（npm run start 的前提）', existsSync(path.join(ROOT, 'node_modules', 'electron')), '先跑 npm install');

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
