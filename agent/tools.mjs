// jingjie (净界) —— Agent 工具实现（本项目唯一需要写的文件）
// 契约见 personal-agent-hub/docs/AGENT_API_STANDARD.md
//
// 所有工具都调用项目自己的真实能力：src/main/services.js 是不依赖 Electron 的 composition root，
// 它造出的就是界面在用的同一批控制器（CleanerController / AggressiveController / SoftwareController /
// StartupController / PlanController）。软件清单与启动项走 scripts/providers/*.ps1 的真实 PowerShell
// 调用，路径守卫复用 src/main/path-guard.js，历史账本直接读真实落盘的 JSON。没有任何写死的假数据。
//
// 只读 7 个，执行 1 个：jingjie.plan_execute 是唯一会动系统的方法，risk='exec'，
// confirm 必填：false 时只回计划、不执行；true 时也只跑已经被 plan_preview 摊开过的条目。
// 提供者脚本会动系统，所以本轮工具面固定在：探测 / 清单 / 预览。
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentError } from './server.mjs';
import { jingjieAppDataDir } from './token-store.mjs';
import { createServices, buildEnvFromProcess, buildFoldersFromProcess } from '../src/main/services.js';
import { environmentIsSafe, protectedRoots } from '../src/main/path-guard.js';
import { resolvePowerShellExecutable, PROVIDER_SCRIPTS } from '../src/main/powershell-runner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECTION_IDS = ['cleanup', 'aggressive', 'software', 'startup'];

export const project = {
  name: 'jingjie',
  version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  summary: '净界：Windows 深度清理 / 软件卸载 / 启动优化。扫描只读，执行需确认，逐项回执。'
};

/** 写入位置：默认仓库内 .data/agent，避免 Agent 进程去动用户真实的 AppData 账本。 */
function dataRoot() {
  return process.env.JINGJIE_DATA_ROOT || path.join(ROOT, '.data', 'agent');
}

/**
 * 真实应用账本（只读）：界面自己写的 history.json 在这里，Agent 只读不写。
 * 目录判据只有一份：agent/token-store.mjs 的 jingjieAppDataDir() —— 本机令牌的落盘位置和
 * 这里读历史的位置必须是同一个目录，各算各的迟早会分叉（守卫文件在 A、界面账本在 B）。
 */
function appDataRoot() {
  return jingjieAppDataDir();
}

/**
 * fs-helper 是执行删除时真正兜住保护边界的原生小程序，仓库不收录二进制
 * （src/main/index.js 的 dev 解析走 vendor/fs-helper，那份不在版本库里）。
 * 这里额外回查安装产物目录 —— 安装包先被移出 项目/ 到 Desktop/竞界-安装包，
 * 2026-10-02 又合并进 Desktop/软件/，所以三个位置都试（新位置在前，旧位置留着当兜底）。
 * 上一版这里写的是 `ROOT/../竞界-安装包`（少算一级，永远找不到），靠下一级的
 * `ROOT/../../竞界-安装包` 才命中 —— 少一级这条注释，下次挪目录还会重犯。
 * 找不到的时候扫描/预览仍可用，扩展清理与提权动作会如实报 fs-helper-missing（fail closed）。
 */
const HELPER_TAIL = path.join('JingJie-runtime', 'resources', 'fs-helper', 'JingJieFsHelper.exe');
function helperCandidates() {
  return [
    process.env.JINGJIE_FS_HELPER,
    path.join(ROOT, 'vendor', 'fs-helper', 'JingJieFsHelper.exe'),
    process.resourcesPath ? path.join(process.resourcesPath, 'fs-helper', 'JingJieFsHelper.exe') : null,
    // 安装产物现在整体住在仓库内的 JingJie-runtime/（.gitignore 排除，所以不入库）。
    path.join(ROOT, 'JingJie-runtime', 'resources', 'fs-helper', 'JingJieFsHelper.exe'),
    // 下面三条是它被挪来挪去时用过的历史位置，留着当兜底，找不到就照旧 fail closed。
    path.join(ROOT, '..', '..', '软件', '竞界-安装包', HELPER_TAIL),
    path.join(ROOT, '..', '..', '竞界-安装包', HELPER_TAIL),
    path.join(ROOT, '..', '竞界-安装包', HELPER_TAIL)
  ].filter(Boolean);
}

function resolveHelper() {
  for (const candidate of helperCandidates()) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

let services = null;
function ready() {
  if (services) return services;
  const env = buildEnvFromProcess(process.env);
  if (!env.userProfile || !env.windowsRoot) throw new AgentError('env_unavailable', '无法确定 USERPROFILE / SystemRoot，净界的路径守卫会拒绝一切操作。');
  services = createServices({
    env,
    folders: buildFoldersFromProcess(process.env),
    dataRoot: dataRoot(),
    providerRoot: process.env.JINGJIE_PROVIDERS_DIR || path.join(ROOT, 'scripts', 'providers'),
    helperPath: resolveHelper()
  });
  return services;
}

const str = (value, max = 260) => String(value ?? '').trim().slice(0, max);
const limit = (value, fallback, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : fallback;
};

function requirePlanId(value) {
  const planId = str(value, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(planId)) {
    throw new AgentError('bad_input', 'planId 必须是 plan_build / plan_preview 返回的 UUID。');
  }
  return planId;
}

function requireSelection(value) {
  if (!Array.isArray(value) || value.length === 0) throw new AgentError('bad_input', 'selection 必须是非空数组：["cleanup:<id>", ...]，id 来自 plan_build / plan.entries。');
  if (value.length > 5000) throw new AgentError('bad_input', 'selection 一次最多 5000 条，请分批。');
  return value.map((entry) => str(entry, 260)).filter(Boolean);
}

function requireSections(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.length) throw new AgentError('bad_input', `sections 必须是非空数组，取值只能是 ${SECTION_IDS.join(' / ')}。`);
  const unknown = value.filter((id) => !SECTION_IDS.includes(id));
  if (unknown.length) throw new AgentError('bad_input', `未知分区：${unknown.join(', ')}；可用：${SECTION_IDS.join(', ')}`);
  return [...new Set(value)];
}

/**
 * plan-controller.build() 的 include 是"覆盖默认值"而不是"白名单"
 * （`{ cleanup:true, aggressive:true, software:true, startup:true, ...include }`），
 * 所以只传想要分区时必须把其余的显式置 false，否则四个还是全装。
 */
function buildOptions(sections) {
  if (!sections) return {};
  const include = {};
  for (const id of SECTION_IDS) include[id] = sections.includes(id);
  return { include };
}

/**
 * 真实读取本机 PowerShell 与系统信息。
 * 解释器按项目自己的 resolvePowerShellExecutable() 从 %SystemRoot% 取，不查 PATH
 * （powershell-runner.js 的 SECURITY-REVIEW S-07 同一条理由）。
 * 输出走 base64：控制台是 GBK，中文产品名直接写 stdout 会乱码，base64 保证管道里只有 ASCII。
 */
// 每个属性一行，行与行之间用换行而不是分号拼接：分号在 @{ } 里连着出现容易被解析成空语句。
const PS_PROBE = `
$ErrorActionPreference='SilentlyContinue'
$rk=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$p=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$os=Get-CimInstance Win32_OperatingSystem
$o=[ordered]@{
psVersion=$PSVersionTable.PSVersion.ToString()
psEdition=$PSVersionTable.PSEdition
admin=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
account=$p.Identity.Name
product=$rk.ProductName
releaseId=$rk.ReleaseId
displayVersion=$rk.DisplayVersion
build="$($rk.CurrentBuildNumber).$($rk.UBR)"
totalMb=[int](($os.TotalVisibleMemorySize/1KB))
freeMb=[int](($os.FreePhysicalMemory/1KB))
bootTime=$os.LastBootUpTime.ToString('o')
locale=$os.Locale
languageMode=(Get-Culture).Name
}
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($o|ConvertTo-Json -Compress)))
`.trim();

function probePowerShell(executable, timeoutMs = 25000) {
  return new Promise((resolve) => {
    execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS_PROBE],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) { resolve({ ok: false, reason: error.code === 'ETIMEDOUT' ? 'powershell-timeout' : `powershell-failed: ${str(error.message, 160)}` }); return; }
        try {
          const payload = JSON.parse(Buffer.from(String(stdout).trim(), 'base64').toString('utf8'));
          resolve({ ok: true, payload });
        } catch (e) { resolve({ ok: false, reason: `powershell-output-unparsable: ${str(e.message, 120)}` }); }
      });
  });
}

/** 依赖脚本是否齐全：真实 stat 每一个 allowlisted provider，并报出只读/写入属性。 */
function inspectProviders(providerRoot) {
  const listed = (() => { try { return fs.readdirSync(providerRoot).filter((n) => n.endsWith('.ps1')); } catch { return []; } })();
  const scripts = Object.entries(PROVIDER_SCRIPTS).map(([name, spec]) => {
    const full = path.join(providerRoot, spec.fileName);
    let stat = null;
    try { stat = fs.statSync(full); } catch { /* missing */ }
    return {
      name,
      fileName: spec.fileName,
      exists: Boolean(stat?.isFile()),
      bytes: stat?.size ?? 0,
      modifiedAt: stat ? stat.mtime.toISOString() : null,
      readOnly: spec.write !== true,
      timeoutMs: spec.timeoutMs
    };
  });
  const extraOnDisk = listed.filter((fileName) => !Object.values(PROVIDER_SCRIPTS).some((spec) => spec.fileName === fileName));
  return {
    providerRoot,
    required: scripts.map((s) => s.fileName),
    scripts,
    complete: scripts.every((s) => s.exists),
    unlistedOnDisk: extraOnDisk
  };
}

function compactSoftware(item) {
  return {
    id: item.id,
    name: str(item.name, 160),
    publisher: str(item.publisher, 120) || null,
    version: str(item.version, 60) || null,
    source: item.source,
    scope: item.scope,
    installLocation: str(item.installLocation, 260) || null,
    estimatedSizeBytes: item.estimatedSizeBytes ?? null,
    uninstallKind: item.uninstallKind,
    risk: item.risk,
    standardUninstallAllowed: item.standardUninstallAllowed,
    protectedReasons: item.protectedReasons
  };
}

function compactStartup(item) {
  return {
    id: item.id,
    name: str(item.name, 120),
    source: item.source,
    scope: item.scope,
    command: str(item.command, 260),
    executablePath: str(item.executablePath, 260) || null,
    registryKey: str(item.registryKey, 200) || null,
    registryValueName: str(item.registryValueName, 120) || null,
    taskPath: str(item.taskPath, 200) || null,
    filePath: str(item.filePath, 260) || null,
    impact: item.impact,
    protected: item.protected,
    protectedReasons: item.protectedReasons,
    canDisable: item.canDisable,
    effect: item.effect ? { category: item.effect.category, confidence: item.effect.confidence, recommendation: item.effect.recommendation, disabledEffect: str(item.effect.disabledEffect, 300) } : null
  };
}

function bytesToMb(bytes) {
  return Math.round((Number(bytes) || 0) / 1024 / 102.4) / 10;
}

/** 把 sections 的 groups 摊平成可选条目，供 preview/execute 直接拿 id。 */
function flattenSelections(summary) {
  return summary.sections.map((section) => ({
    sectionId: section.id,
    label: section.label,
    status: section.status,
    reason: section.reason,
    totals: section.totals,
    groups: section.groups.map((group) => ({
      id: `${section.id}:${group.id}`,
      label: group.label,
      itemCount: group.entryCount,
      sizeBytes: group.sizeBytes,
      defaultSelectedCount: group.defaultSelectedCount,
      irreversibleCount: group.irreversibleCount,
      administratorCount: group.administratorCount
    }))
  }));
}

function shapePreview(preview, cap) {
  return {
    planId: preview.planId,
    dryRun: true,
    deletionsExecuted: false,
    writesToDisk: false,
    generatedAt: preview.generatedAt,
    totalSizeBytes: preview.totalSizeBytes,
    totalSizeMb: bytesToMb(preview.totalSizeBytes),
    totalItemCount: preview.totalItemCount,
    needsAdministrator: preview.needsAdministrator,
    containsIrreversible: preview.containsIrreversible,
    containsProtectedSelection: preview.containsProtectedSelection,
    sections: preview.sections.map((section) => ({
      id: section.id,
      label: section.label,
      itemCount: section.itemCount,
      sizeBytes: section.sizeBytes,
      sizeMb: bytesToMb(section.sizeBytes),
      flags: section.flags,
      pathCount: section.pathCount,
      pathsListed: Math.min(section.paths.length, cap),
      truncated: section.pathCount > cap,
      paths: section.paths.slice(0, cap).map((entry) => ({ path: str(entry.path, 260), sizeBytes: entry.sizeBytes, action: entry.action, label: str(entry.label, 120) }))
    }))
  };
}

const tools = [
  {
    name: 'jingjie.env_probe',
    description: '只读探测本机运行环境：OS 版本与内存、是否管理员、PowerShell 版本、净界路径守卫用的环境变量与受保护根目录、五个 allowlisted provider 脚本是否齐全、fs-helper 是否可用。会真实执行一次只读 PowerShell 查询，不扫描文件系统、不改动任何东西。',
    risk: 'read',
    input_schema: {
      type: 'object',
      properties: {
        providerCheck: { type: 'boolean', description: '默认 true：stat 每个 provider 脚本并比对 allowlist' },
        powerShellProbe: { type: 'boolean', description: '默认 true：真实调用一次 SystemRoot 下的 powershell.exe 取版本/权限；传 false 可跳过（约 1-3 秒）' }
      },
      required: [],
      additionalProperties: false
    },
    handler: async (input) => {
      const s = ready();
      const resolved = resolvePowerShellExecutable(s.powerShell.environment);
      const ps = input.powerShellProbe === false ? { ok: false, skipped: true, reason: 'powerShellProbe=false' } : await probePowerShell(resolved.executable);
      const envRoots = {};
      for (const [key, value] of Object.entries(s.env)) {
        let exists = false;
        try { exists = fs.existsSync(String(value)); } catch { /* keep false */ }
        envRoots[key] = { path: str(value, 260), exists };
      }
      return {
        probedAt: new Date().toISOString(),
        project: { name: project.name, version: project.version, repoRoot: ROOT },
        host: {
          hostname: str(os.hostname(), 80),
          platform: os.platform(),
          arch: os.arch(),
          osRelease: str(os.release(), 40),
          nodeVersion: process.version,
          cpuCount: os.cpus().length,
          totalMemoryMb: Math.round(os.totalmem() / 1048576)
        },
        powerShell: {
          resolvedExecutable: resolved.executable,
          resolvedFromSystemRoot: resolved.resolvedFromSystemRoot,
          querySucceeded: ps.ok === true,
          skipped: ps.skipped === true,
          reason: ps.reason ?? null,
          version: ps.ok ? str(ps.payload.psVersion, 30) : null,
          edition: ps.ok ? str(ps.payload.psEdition, 20) : null,
          administrator: ps.ok ? ps.payload.admin === true : null,
          account: ps.ok ? str(ps.payload.account, 90) : null,
          culture: ps.ok ? str(ps.payload.languageMode, 20) : null
        },
        windows: ps.ok ? {
          product: str(ps.payload.product, 90),
          build: str(ps.payload.build, 20),
          releaseId: str(ps.payload.releaseId, 20),
          displayVersion: str(ps.payload.displayVersion, 20),
          totalVisibleMemoryMb: ps.payload.totalMb ?? null,
          freePhysicalMemoryMb: ps.payload.freeMb ?? null,
          lastBoot: ps.payload.bootTime ?? null
        } : null,
        // 真实判据：path-guard 在每次扫描/删除前都会重新检查这一条，为 false 时所有规则直接拒绝
        environmentIsSafe: environmentIsSafe(s.env),
        envRoots,
        protectedRoots: protectedRoots(s.env),
        rules: s.rules.map((rule) => ({ id: rule.id, label: rule.label, root: rule.root, mode: rule.mode, minAgeHours: rule.minAgeHours, enabled: rule.enabled })),
        fsHelper: s.helperPath ?? null,
        fsHelperAvailable: Boolean(s.helperPath),
        fsHelperSearched: helperCandidates(),
        providers: input.providerCheck === false ? { checked: false } : inspectProviders(s.powerShell.providerRoot),
        dataRoot: dataRoot(),
        appDataRoot: appDataRoot(),
        execToolsBlockedWithoutHelper: !s.helperPath
      };
    }
  },

  {
    name: 'jingjie.software_inventory',
    description: '只读扫描本机已安装软件（注册表 Uninstall 四个视图 + Get-AppxPackage），走项目自己的 software-inventory.ps1 provider。返回真实条数、可标准卸载数、受保护数与分页/过滤后的清单。不卸载任何东西。',
    risk: 'read',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '按名称或发布者过滤（子串，不区分大小写）' },
        onlyUninstallable: { type: 'boolean', description: 'true 时只返回允许标准卸载的条目' },
        source: { type: 'string', enum: ['registry', 'appx'], description: '只看某个来源' },
        page: { type: 'number', description: '1 起始的页码，默认 1' },
        pageSize: { type: 'number', description: '每页多少条，默认 50，上限 300' }
      },
      required: [],
      additionalProperties: false
    },
    handler: async (input) => {
      const s = ready();
      const report = await s.softwareController.inventory();
      const needle = str(input.query, 120).toLocaleLowerCase('zh-CN');
      let items = report.items;
      if (input.onlyUninstallable) items = items.filter((item) => item.standardUninstallAllowed);
      if (input.source) items = items.filter((item) => item.source === input.source);
      if (needle) items = items.filter((item) => `${item.name} ${item.publisher ?? ''}`.toLocaleLowerCase('zh-CN').includes(needle));
      const size = limit(input.pageSize, 50, 300);
      const page = Math.max(1, Math.round(Number(input.page) || 1));
      const start = (page - 1) * size;
      const slice = items.slice(start, start + size);
      return {
        scannedAt: report.startedAt,
        expiresAt: report.expiresAt,
        totalInstalled: report.items.length,
        standardUninstallable: report.items.filter((item) => item.standardUninstallAllowed).length,
        protectedCount: report.items.filter((item) => item.risk === 'protected').length,
        bySource: { registry: report.items.filter((i) => i.source === 'registry').length, appx: report.items.filter((i) => i.source === 'appx').length },
        totalEstimatedSizeMb: bytesToMb(report.items.reduce((sum, item) => sum + (item.estimatedSizeBytes ?? 0), 0)),
        filter: { query: needle || null, onlyUninstallable: input.onlyUninstallable === true, source: input.source ?? null },
        matched: items.length,
        page,
        pageSize: size,
        pages: Math.max(1, Math.ceil(items.length / size)),
        returned: slice.length,
        truncated: start + slice.length < items.length,
        inventoryTaskId: report.taskId,
        items: slice.map(compactSoftware)
      };
    }
  },

  {
    name: 'jingjie.startup_inventory',
    description: '只读扫描登录启动入口（Run/RunOnce 注册表、启动文件夹、非 Microsoft 计划任务），走项目自己的 startup-inventory.ps1 provider，带净界的影响说明与保护判定。不修改启动项。',
    risk: 'read',
    input_schema: {
      type: 'object',
      properties: {
        onlyDisableable: { type: 'boolean', description: 'true 时只返回可关闭的条目' },
        source: { type: 'string', enum: ['registry', 'startup-folder', 'task'], description: '只看某个来源' },
        limit: { type: 'number', description: '最多返回多少条，默认 200，上限 500' }
      },
      required: [],
      additionalProperties: false
    },
    handler: async (input) => {
      const s = ready();
      const report = await s.startupController.inventory();
      let items = report.items;
      if (input.onlyDisableable) items = items.filter((item) => item.canDisable);
      if (input.source) items = items.filter((item) => item.source === input.source);
      const cap = limit(input.limit, 200, 500);
      return {
        scannedAt: report.startedAt,
        expiresAt: report.expiresAt,
        total: report.items.length,
        disableable: report.items.filter((item) => item.canDisable).length,
        protectedCount: report.items.filter((item) => item.protected).length,
        bySource: report.items.reduce((acc, item) => { acc[item.source] = (acc[item.source] ?? 0) + 1; return acc; }, {}),
        filter: { onlyDisableable: input.onlyDisableable === true, source: input.source ?? null },
        matched: items.length,
        inventoryTaskId: report.taskId,
        items: items.slice(0, cap).map(compactStartup),
        truncated: items.length > cap
      };
    }
  },

  {
    name: 'jingjie.plan_build',
    description: '只读：把四个子系统（深度清理 / 扩展清理 / 软件卸载 / 启动优化）汇成一份可勾选的维护计划快照，返回分组计数与容量。15 分钟过期，不做任何改动。',
    risk: 'read',
    input_schema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          items: { type: 'string', enum: SECTION_IDS },
          description: '只装配这些分区；缺省全装'
        },
        includeItems: { type: 'boolean', description: 'true 时额外带回每组的可选条目 id（用于 preview/execute）' },
        itemLimit: { type: 'number', description: 'includeItems 时每组最多带回多少条，默认 40，上限 300' }
      },
      required: [],
      additionalProperties: false
    },
    handler: async (input) => {
      const s = ready();
      const summary = await s.planController.build(buildOptions(requireSections(input.sections)));
      const cap = limit(input.itemLimit, 40, 300);
      const out = {
        planId: summary.planId,
        startedAt: summary.startedAt,
        expiresAt: summary.expiresAt,
        totals: summary.sections.map((section) => ({ id: section.id, label: section.label, status: section.status, reason: section.reason ?? null, itemCount: section.totals?.itemCount ?? 0, sizeBytes: section.totals?.bytes ?? 0, sizeMb: bytesToMb(section.totals?.bytes ?? 0) })),
        groups: flattenSelections(summary)
      };
      if (input.includeItems) {
        out.entries = {};
        for (const section of summary.sections) {
          try {
            out.entries[section.id] = s.planController.entriesOf(summary.planId, section.id).slice(0, cap).map((entry) => ({
              selection: `${section.id}:${entry.id}`,
              label: str(entry.label, 160),
              path: str(entry.path, 260) || null,
              sizeBytes: entry.sizeBytes ?? 0,
              selectedByDefault: entry.selectedByDefault === true,
              irreversible: entry.irreversible === true,
              requiresAdministrator: entry.requiresAdministrator === true,
              protected: entry.protected === true,
              standardUninstallAllowed: entry.standardUninstallAllowed
            }));
          } catch { /* a failed section has no entries */ }
        }
      }
      return out;
    }
  },

  {
    name: 'jingjie.plan_preview',
    description: '只读 dry-run：给定维护计划参数（planId + selection，或直接给 sections 现场建一份计划），返回将要影响的绝对路径清单与总大小，并标出需要管理员、不可恢复、受保护的条目。这一步不删除、不卸载、不写注册表，是执行前的强制一步。',
    risk: 'read',
    input_schema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'plan_build 返回的 UUID；省略时按 sections 现场建一份只读计划' },
        selection: { type: 'array', items: { type: 'string' }, description: '["cleanup:<id>", "aggressive:<id>", ...]；省略时取该计划里默认勾选的条目' },
        sections: { type: 'array', items: { type: 'string', enum: SECTION_IDS }, description: '未给 planId 时用来现场建计划；缺省四个分区全装' },
        pathLimit: { type: 'number', description: '每个分区最多列出多少条绝对路径，默认 120，上限 1000' }
      },
      required: [],
      additionalProperties: false
    },
    handler: async (input) => {
      const s = ready();
      const sectionsWanted = requireSections(input.sections);
      let planId = input.planId ? requirePlanId(input.planId) : null;
      let builtNow = false;
      if (!planId) {
        const summary = await s.planController.build(buildOptions(sectionsWanted));
        planId = summary.planId;
        builtNow = true;
      }
      let selection = input.selection ? requireSelection(input.selection) : null;
      let selectionSource = 'explicit';
      if (!selection) {
        selection = [];
        for (const sectionId of SECTION_IDS) {
          let entries = [];
          try { entries = s.planController.entriesOf(planId, sectionId); } catch { continue; }
          for (const entry of entries) if (entry.selectedByDefault === true) selection.push(`${sectionId}:${entry.id}`);
        }
        selectionSource = 'default-selected';
      }
      if (!selection.length) {
        return {
          planId, dryRun: true, deletionsExecuted: false, writesToDisk: false,
          planBuiltForThisCall: builtNow, selectionSource,
          totalItemCount: 0, totalSizeBytes: 0, totalSizeMb: 0, sections: [],
          message: '这一批计划里没有默认勾选的条目（软件卸载与启动优化永不默认勾选）。先从 plan_build 带 includeItems:true 取条目 id，再用 selection 显式指定。'
        };
      }
      const preview = await s.planController.preview(planId, selection);
      const cap = limit(input.pathLimit, 120, 1000);
      return {
        ...shapePreview(preview, cap),
        planBuiltForThisCall: builtNow,
        selectionSource,
        selectionCount: selection.length,
        note: '本工具只做只读展开：不落任何删除动作，不写账本，不改注册表。真实改动只有 jingjie.plan_execute 带 confirm:true 才会发生，且只能执行这里摊开过的条目。'
      };
    }
  },

  {
    name: 'jingjie.history',
    description: '只读查询真实历史账本：净界界面写下的清理/扩展清理/软件/启动项运行记录（默认在 %APPDATA%\\jingjie，只读不改）+ Agent 侧计划运行记录。返回真实条数，没有记录就如实报空并说明什么时候才会有。',
    risk: 'read',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['plan', 'cleanup', 'aggressive', 'software', 'startup', 'all'], description: '默认 all' },
        limit: { type: 'number', description: '每类最多返回多少条，默认 10，上限 50' }
      },
      required: [],
      additionalProperties: false
    },
    handler: async (input) => {
      const s = ready();
      const cap = limit(input.limit, 10, 50);
      const kind = str(input.kind, 20) || 'all';
      const result = { queriedAt: new Date().toISOString(), planRuns: [], planRunTotal: 0, appLedgers: {}, ledgerTotals: {}, sources: [], empty: false, notes: [] };

      if (kind === 'all' || kind === 'plan') {
        const runs = await s.planController.history();
        result.planRunTotal = runs.length;
        result.planRuns = runs.slice(0, cap).map((run) => ({
          runId: run.runId,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          counts: run.counts,
          freedBytes: run.freedBytes,
          sections: run.sections.map((section) => ({ sectionId: section.sectionId, failed: section.items.filter((item) => item.status === 'failed').length, total: section.items.length }))
        }));
        result.sources.push(`${dataRoot()}/plan-history.json`);
        if (!runs.length) result.notes.push('plan-history.json 还没有记录：它只在通过本 Agent 调用过一次 jingjie.plan_execute（confirm:true）之后才会出现。');
      }

      const ledgerFiles = { cleanup: 'history.json', aggressive: 'aggressive-history.json', software: 'software-history.json', startup: 'startup-history.json' };
      for (const [name, file] of Object.entries(ledgerFiles)) {
        if (kind !== 'all' && kind !== name) continue;
        for (const dir of [appDataRoot(), dataRoot()]) {
          if (!dir) continue;
          const full = path.join(dir, file);
          if (!fs.existsSync(full)) continue;
          let entries = [];
          try { entries = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { entries = []; }
          if (!Array.isArray(entries)) continue;
          result.ledgerTotals[name] = entries.length;
          result.appLedgers[name] = entries.slice(0, cap).map((entry) => name === 'startup'
            ? {
              id: entry.id ?? null,
              itemId: entry.itemId ?? null,
              name: entry.original?.name ? str(entry.original.name, 120) : null,
              command: entry.original?.command ? str(entry.original.command, 200) : null,
              status: entry.status ?? null,
              startedAt: entry.startedAt ?? null,
              finishedAt: entry.finishedAt ?? null,
              hasBackup: Boolean(entry.backup)
            }
            : {
              taskId: entry.taskId ?? entry.id ?? null,
              startedAt: entry.startedAt ?? null,
              finishedAt: entry.finishedAt ?? null,
              requestedCount: entry.requestedCount ?? null,
              succeededCount: entry.succeededCount ?? null,
              failedCount: entry.failedCount ?? null,
              skippedCount: entry.skippedCount ?? null,
              freedBytes: entry.freedBytes ?? 0,
              quarantinedBytes: entry.quarantinedBytes ?? 0,
              cancelled: entry.cancelled ?? null,
              resultCount: Array.isArray(entry.results) ? entry.results.length : null
            });
          result.sources.push(full);
          break;
        }
        if (!(name in result.ledgerTotals)) {
          result.ledgerTotals[name] = 0;
          result.notes.push(`${name}: 没有账本文件（查过 ${[appDataRoot(), dataRoot()].filter(Boolean).join(' 与 ')}\\${file}）—— 这个分区还没在净界里真实跑过一次动作。`);
        }
      }

      const totalRecords = result.planRunTotal + Object.values(result.ledgerTotals).reduce((a, b) => a + b, 0);
      result.empty = totalRecords === 0;
      result.totalRecords = totalRecords;
      if (result.empty) result.notes.push('两个账本位置都是空的：净界的记录只有在真实执行过一次动作（界面里跑，或本 Agent 调 plan_execute）之后才会落盘；只扫描不会写历史。');
      return result;
    }
  },

  {
    name: 'jingjie.quarantine_list',
    description: '只读列出隔离区（可恢复的 7 天保留文件）与启动项备份：路径、大小、到期时间。.reg 注册表备份也在这里报出来。',
    risk: 'read',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '最多返回多少条，默认 40，上限 200' } },
      required: [],
      additionalProperties: false
    },
    handler: async (input) => {
      const s = ready();
      const cap = limit(input.limit, 40, 200);
      const entries = await s.quarantine.list();
      const regDir = path.join(dataRoot(), 'startup-reg-backups');
      let regBackups = [];
      try { regBackups = fs.readdirSync(regDir).filter((name) => name.endsWith('.reg')); } catch { /* none yet */ }
      return {
        quarantineRoot: path.join(dataRoot(), 'quarantine'),
        total: entries.length,
        totalSizeBytes: entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
        truncated: entries.length > cap,
        entries: entries.slice(0, cap).map((entry) => ({
          id: entry.id,
          ruleId: entry.ruleId,
          originalPath: str(entry.originalPath, 260),
          sizeBytes: entry.sizeBytes,
          sha256: entry.sha256,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt
        })),
        startupRegBackups: regBackups.slice(0, cap),
        startupBackupRoot: path.join(dataRoot(), 'startup-backups')
      };
    }
  },

  {
    name: 'jingjie.plan_execute',
    description: '执行已预览的维护计划：唯一会真实改动本机系统的工具（删缓存/隔离文件/清空回收站/卸载软件/关闭启动项）。confirm 不是 true 时只返回预览计划并说明未执行；confirm:true 才会真跑，且每个条目都必须已经被 jingjie.plan_preview 摊开过路径。逐条返回真实结果与失败原因。',
    risk: 'exec',
    input_schema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'plan_build / plan_preview 返回的 UUID' },
        selection: { type: 'array', items: { type: 'string' }, description: '与 preview 同一批 id；retryFailed=true 时可省略' },
        sections: { type: 'array', items: { type: 'string', enum: SECTION_IDS }, description: '未给 planId 时现场建计划并用默认勾选项' },
        confirm: { type: 'boolean', description: '必填。false = 只返回预览计划不执行；true = 真实改动系统（删缓存/卸载/关启动项），且只能跑 plan_preview 摊开过的条目' },
        acknowledgeIrreversible: { type: 'boolean', description: '选中含回收站等不可恢复动作时必须 true' },
        retryFailed: { type: 'boolean', description: 'true = 只重试上次失败的条目（策略拒绝的不重试），同样要求 confirm:true' },
        pathLimit: { type: 'number', description: 'confirm 为 false 时返回的预览里，每个分区最多列多少条路径，默认 120，上限 1000' }
      },
      required: ['confirm'],
      additionalProperties: false
    },
    handler: async (input) => {
      const s = ready();
      const sectionsWanted = requireSections(input.sections);
      let planId = input.planId ? requirePlanId(input.planId) : null;
      let builtNow = false;
      if (!planId) {
        const summary = await s.planController.build(buildOptions(sectionsWanted));
        planId = summary.planId;
        builtNow = true;
      }
      let selection = input.selection ? requireSelection(input.selection) : null;
      if (!selection && input.retryFailed !== true) {
        selection = [];
        for (const sectionId of SECTION_IDS) {
          let entries = [];
          try { entries = s.planController.entriesOf(planId, sectionId); } catch { continue; }
          for (const entry of entries) if (entry.selectedByDefault === true) selection.push(`${sectionId}:${entry.id}`);
        }
      }

      // confirm 不是 true -> 只把计划摊开，绝不执行。这是本工具面的硬边界。
      if (input.confirm !== true) {
        const cap = limit(input.pathLimit, 120, 1000);
        const preview = selection && selection.length ? await s.planController.preview(planId, selection) : null;
        return {
          executed: false,
          reason: 'needs-confirmation',
          planId,
          planBuiltForThisCall: builtNow,
          message: '这个工具会真实改动系统，本轮没有执行任何东西。把下面的计划摊给用户确认后，再带 confirm:true（必要时加 acknowledgeIrreversible:true）重试。',
          selectionCount: selection?.length ?? 0,
          preview: preview ? shapePreview({ ...preview, planId }, cap) : null
        };
      }

      if (input.retryFailed === true) {
        try {
          const outcome = await s.planController.retry({});
          if (!outcome.retried) return { retried: 0, message: '上一次运行没有可重试的失败条目。', runId: outcome.run.runId, counts: outcome.run.counts, freedBytes: outcome.run.freedBytes };
          return { retried: outcome.retried, runId: outcome.run.runId, counts: outcome.run.counts, freedBytes: outcome.run.freedBytes, freedMb: bytesToMb(outcome.run.freedBytes) };
        } catch (error) {
          if (error.message === 'no-run-to-retry') throw new AgentError('not_found', '这个进程里还没有执行过任何计划，先 plan_build -> plan_preview -> plan_execute。');
          if (error.message === 'expired-plan') throw new AgentError('expired', '计划快照已超过 15 分钟或进程已重启，请重新 plan_build。');
          throw new AgentError('retry_failed', error.message);
        }
      }

      selection = requireSelection(selection);
      const preview = await s.planController.preview(planId, selection);
      const wantsIrreversible = preview.sections.some((section) => section.id === 'aggressive' && section.flags.irreversible);
      if (wantsIrreversible && input.acknowledgeIrreversible !== true) {
        throw new AgentError('needs_confirmation', '这一批里有不可恢复的动作（清空回收站）：预览已经给出容量，请把它摊给用户，再带 acknowledgeIrreversible:true 重试。');
      }
      const run = await s.planController.execute(planId, selection, { confirm: true, irreversibleAck: wantsIrreversible });
      return {
        executed: true,
        runId: run.runId,
        planId: run.planId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        freedBytes: run.freedBytes,
        freedMb: bytesToMb(run.freedBytes),
        counts: run.counts,
        previewedTotals: { sizeBytes: preview.totalSizeBytes, itemCount: preview.totalItemCount },
        sections: run.sections.map((section) => ({
          sectionId: section.sectionId,
          label: section.label,
          items: section.items.map((item) => ({
            itemId: item.itemId,
            label: str(item.label, 160),
            status: item.status,
            reason: item.reason ?? null,
            sizeBytes: item.sizeBytes ?? 0,
            path: str(item.path, 260) || null,
            restartRequired: item.restartRequired === true
          }))
        }))
      };
    }
  }
];

export { tools };
