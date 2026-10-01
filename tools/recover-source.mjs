#!/usr/bin/env node
/**
 * recover-source.mjs — 把抽出的打包产物还原成可维护源码树
 *
 * 输入：tools/extract-asar.mjs 抽出的 app.asar 内容目录（含 out/ 与 package.json）
 *       以及安装目录里散开的 resources/providers、resources/brand。
 * 输出：src/main/*.js（按原始模块边界切分）、src/preload/preload.cjs、
 *       src/renderer/**（vendor 区 + 按组件切分的应用区）、docs 用的结构报告。
 *
 * 为什么能切：electron-vite 产出的 main.js 与 renderer bundle 都是 **未压缩** 的
 * esbuild 拼接结果 —— 函数名、注释结构、代码顺序全部保留，只是每个原始模块的顶层
 * 声明被平铺进同一个文件，重名符号被加了 $1/$2… 后缀。因此按行区间切片 + 补 import/
 * export 即可逐模块还原，**不需要手抄，也不改一个字节的方法体**（方法体原样搬运，
 * 只有 $N 后缀保留，因为原源码里每个模块本来就有自己的 canonical 副本）。
 *
 * 用法：node tools/recover-source.mjs <extractedAsarDir> <repoRoot> [--providers-dir <dir>] [--dry-run]
 * stdout 只用 ASCII。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const pos = args.filter((a) => !a.startsWith('--'));
const extracted = pos[0];
const repoRoot = pos[1];
const DRY = flags.has('--dry-run');
if (!extracted || !repoRoot) {
  console.log('usage: node tools/recover-source.mjs <extractedAsarDir> <repoRoot> [--providers-dir <dir>] [--dry-run]');
  process.exit(2);
}
const providersDir = (() => {
  const i = args.indexOf('--providers-dir');
  return i >= 0 ? args[i + 1] : null;
})();

const say = (line) => console.log(line.replace(/[^\x20-\x7e\n\r\t]/g, '?'));

// ---- 共用 import 片段（与原始 bundle 头部逐字一致）-----------------------
const IMP = {
  path: 'import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";',
  fsp: 'import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";',
  fs: 'import { createReadStream, constants, realpathSync } from "node:fs";',
  crypto: 'import { randomUUID, createHash } from "node:crypto";',
  child: 'import { execFile, spawn } from "node:child_process";',
  rl: 'import { createInterface } from "node:readline";',
  util: 'import { promisify } from "node:util";',
  electron: 'import { ipcMain, app, BrowserWindow, shell } from "electron";',
  url: 'import { pathToFileURL } from "node:url";',
  moduleShim: 'const __filename = import.meta.filename;\nconst __dirname = import.meta.dirname;'
};

/**
 * MAIN_MANIFEST: 每个模块的 [相对 out/main/main.js 的行区间, import 列表, export 列表]
 * 区间是 bundle 的 1-based 闭区间。分组依据 = bundle 里顶层声明的顺序，
 * 每个分组就是原项目里一个模块（同前缀的 $N 后缀符号留在自己那一组里，不合并）。
 */
const MAIN_MANIFEST = [
  { file: 'window-options.js', note: 'window creation options (preload path, icon path, webPreferences)', ranges: [[14, 27]], imports: [IMP.path], exports: ['getPreloadPath', 'getWindowIconPath', 'getWindowWebPreferences'] },
  {
    file: 'path-guard.js',
    note: 'the single safety boundary: rule-root allowlist, protected roots, symlink/junction rejection, physical (realpath) re-check',
    ranges: [[28, 152]],
    imports: [IMP.path, 'import { lstat, realpath } from "node:fs/promises";'],
    exports: ['PERSONAL_FOLDERS', 'canonicalRule', 'isAtOrBelowRule', 'isVolumeRoot', 'environmentIsSafe', 'expectedRuleRoot', 'trustedRuleAnchor', 'evaluateRuleRoot', 'evaluatePhysicalRuleRoot', 'protectedRoots', 'evaluatePath', 'evaluatePhysicalPath', 'evaluateRestoreTargetPath'],
    renames: [['canonical$6', 'canonicalRule'], ['isAtOrBelow$2', 'isAtOrBelowRule']]
  },
  { file: 'rules.js', note: 'default cleanup rule catalogue', ranges: [[153, 162]], imports: [IMP.path], exports: ['createDefaultRules'] },
  {
    file: 'storage.js',
    note: 'crash-safe JSON store + serial executors (one destructive writer each)',
    ranges: [[163, 279]],
    imports: [IMP.path, IMP.fsp, IMP.crypto],
    exports: ['AtomicJsonStore', 'SerialExecutor', 'hasCode'],
    renames: [['hasCode$1', 'hasCodeOnce']]
  },
  {
    file: 'quarantine.js',
    note: '7-day recoverable quarantine (hash-checked move/restore, expired purge)',
    ranges: [[280, 474]],
    imports: [IMP.path, IMP.fs, IMP.fsp, IMP.crypto, 'import { AtomicJsonStore, SerialExecutor, hasCode } from "./storage.js";'],
    exports: ['hashFile', 'moveFile', 'QuarantineService']
  },
  {
    file: 'cleanup-engine.js',
    note: 'scan -> revalidate -> delete/quarantine, per-item result ledger',
    ranges: [[475, 706]],
    imports: [IMP.path, IMP.fsp, IMP.crypto, 'import { evaluatePath, evaluatePhysicalPath, evaluatePhysicalRuleRoot, trustedRuleAnchor } from "./path-guard.js";'],
    exports: ['executeCleanup', 'scanRules', 'itemId', 'errorReason'],
    renames: [['errorReason$1', 'errorReasonOf'], ['canonical$6', 'canonicalRule'], ['isAtOrBelow$2', 'isAtOrBelowRule']]
  },
  { file: 'request-validators.js', note: 'strict IPC request shape checks (ids only, never paths or commands)', ranges: [[707, 763]], imports: [], exports: ['validateSoftwareUninstallRequest', 'validateStartupDisableRequest', 'validateIdBatch', 'validateCleanRequest', 'validateAggressiveCleanRequest', 'validateId'] },
  {
    file: 'cleaner-controller.js',
    note: 'deep cleanup controller: snapshot(15min) -> clean -> history',
    ranges: [[764, 939]],
    imports: [IMP.path, IMP.crypto, 'import { AtomicJsonStore, SerialExecutor } from "./storage.js";', 'import { scanRules, executeCleanup } from "./cleanup-engine.js";', 'import { validateCleanRequest } from "./request-validators.js";'],
    exports: ['CleanerController']
  },
  { file: 'ipc.js', note: 'IPC channel table + trusted-sender wrapper', ranges: [[940, 1007]], imports: [IMP.electron, 'import { validateCleanRequest, validateSoftwareUninstallRequest, validateStartupDisableRequest, validateAggressiveCleanRequest, validateId } from "./request-validators.js";'], exports: ['IPC_CHANNELS', 'registerIpcHandlers', 'isTrustedRendererUrl'] },
  { file: 'native-delete.js', note: 'fs-helper subprocess: anchored, size/mtime-checked single-file delete (batch session)', ranges: [[1008, 1146]], imports: [IMP.path, IMP.child, IMP.rl, IMP.util], exports: ['NativeDeleteSession', 'NativeSecureFileOperations'] },
  { file: 'powershell-runner.js', note: 'allowlisted PowerShell provider scripts, base64 payload in / JSON out', ranges: [[1147, 1191]], imports: [IMP.path, IMP.child, IMP.util], exports: ['PROVIDER_SCRIPTS', 'PowerShellRunner'] },
  { file: 'software-inventory.js', note: 'registry + appx inventory normalisation and dedupe', ranges: [[1192, 1251]], imports: [IMP.path, IMP.crypto], exports: ['normalizeInstalledSoftware', 'uninstallKind'], renames: [['text$1', 'trimText'], ['dedupeKey$1', 'softwareDedupeKey'], ['richness$1', 'softwareRichness']] },
  { file: 'software-policy.js', note: 'uninstall risk classification: what may never be removed by this app', ranges: [[1252, 1343]], imports: [IMP.path], exports: ['classifySoftware', 'applySoftwarePolicy', 'OFFICIAL_ONLY_PATTERNS', 'IMMUTABLE_PATTERNS'], renames: [['canonical$5', 'canonicalPath'], ['atOrBelow$1', 'isAtOrBelowPath']] },
  { file: 'software-provider.js', note: 'software provider adapter (PowerShell inventory + policy)', ranges: [[1344, 1356]], imports: ['import { normalizeInstalledSoftware } from "./software-inventory.js";', 'import { applySoftwarePolicy } from "./software-policy.js";'], exports: ['SoftwareProvider'] },
  { file: 'uninstall-plan.js', note: 'command line planning: no shell, blocked interpreter hosts, msi/appx/exe kinds', ranges: [[1357, 1474]], imports: [IMP.path], exports: ['createUninstallAction', 'tokenizeWindowsCommandLine', 'planRegisteredExecutable', 'BLOCKED_EXECUTABLES', 'UNINSTALL_TIMEOUT_MS'] },
  {
    file: 'software-controller.js',
    note: 'uninstall job runner with persisted per-item plan/results',
    ranges: [[1475, 1653]],
    imports: [IMP.crypto, 'import { AtomicJsonStore, SerialExecutor } from "./storage.js";', 'import { createUninstallAction } from "./uninstall-plan.js";'],
    exports: ['SoftwareController']
  },
  { file: 'elevation.js', note: 'elevated process runner (fs-helper UAC bridge)', ranges: [[1654, 1704]], imports: [IMP.child], exports: ['NativeElevatedProcessRunner', 'invokeElevatedHelper'] },
  { file: 'uninstall-executors.js', note: 'direct/elevated process runners, appx runner, exit-code normalisation', ranges: [[1705, 1771]], imports: [IMP.child], exports: ['WindowsUninstallProcessRunner', 'PowerShellAppxActionRunner', 'ExecFileProcessRunner', 'normalizeResult', 'UninstallExecutor'] },
  { file: 'startup-inventory.js', note: 'startup entry normalisation (registry / startup folder / scheduled task)', ranges: [[1772, 1837]], imports: [IMP.path, IMP.crypto], exports: ['normalizeStartupEntries', 'isReversibleRecord'] },
  { file: 'startup-policy.js', note: 'which startup entries must never be touched', ranges: [[1838, 1877]], imports: [IMP.path], exports: ['classifyStartupEntry', 'applyStartupPolicy', 'PROTECTED_PATTERNS'], renames: [['canonical$4', 'canonicalPath'], ['atOrBelow', 'isAtOrBelowPath']] },
  { file: 'startup-effects.js', note: 'honest impact wording per startup category (no invented seconds)', ranges: [[1878, 1962]], imports: [IMP.path], exports: ['EFFECTS', 'classifyStartupEffect'] },
  { file: 'startup-provider.js', note: 'startup provider adapter', ranges: [[1963, 1978]], imports: [IMP.path, 'import { normalizeStartupEntries } from "./startup-inventory.js";', 'import { applyStartupPolicy } from "./startup-policy.js";', 'import { classifyStartupEffect } from "./startup-effects.js";'], exports: ['StartupProvider'] },
  { file: 'startup-actions.js', note: 'reversible disable/restore: value re-check + file rename into backup root', ranges: [[1979, 2097]], imports: [IMP.path, IMP.fs, IMP.fsp], exports: ['StartupActions', 'validBackupId'], renames: [['canonical$3', 'canonicalPath']] },
  { file: 'startup-controller.js', note: 'startup job ledger (planned/started/disabled/failed/restored)', ranges: [[2098, 2201]], imports: [IMP.crypto, 'import { AtomicJsonStore, SerialExecutor } from "./storage.js";'], exports: ['StartupController'] },
  { file: 'elevated-startup-runner.js', note: 'elevated startup-action runner through fs-helper', ranges: [[2202, 2240]], imports: [IMP.path, IMP.child], exports: ['NativeElevatedStartupRunner'], renames: [['encode$1', 'encodeValue']] },
  { file: 'aggressive-native.js', note: 'fs-helper v2 session: protected-root manifest handed to the native side before any delete', ranges: [[2241, 2387]], imports: [IMP.path, IMP.child, IMP.rl, IMP.util], exports: ['NativeAggressiveDeleteSession', 'NativeAggressiveOperations'], renames: [['decode', 'decodeValue'], ['encode', 'encodeValue']] },
  { file: 'maintenance.js', note: 'Windows official maintenance actions (delivery optimization / DISM), one action per elevated call', ranges: [[2388, 2486]], imports: [IMP.child], exports: ['MaintenanceProvider', 'NativeElevatedMaintenanceRunner', 'ALLOWED_ACTIONS', 'ACTION_COPY', 'isActionId'] },
  { file: 'protected-roots.js', note: 'personal folders + cloud sync roots resolution, lexical and physical', ranges: [[2487, 2549]], imports: [IMP.path, IMP.fs, IMP.fsp], exports: ['resolveProtectedRoots', 'isProtectedPath', 'isDirectory', 'physicalPathIsProtected', 'uniqueAbsolute'], renames: [['canonical$2', 'canonicalPath'], ['isAtOrBelow$1', 'isAtOrBelowPath'], ['protectedRoots2', 'protectedRootsArg']] },
  { file: 'aggressive-rules.js', note: 'rebuildable cache catalogue (fixed roots + discovered browser profiles)', ranges: [[2550, 2625]], imports: [IMP.path, IMP.fsp, 'import { isDirectory, physicalPathIsProtected } from "./protected-roots.js";'], exports: ['fixedDefinitions', 'discoverAggressiveRules', 'browserCacheDefinitions', 'profileDirectories'], renames: [['protectedRoots2', 'protectedRootsArg']] },
  { file: 'aggressive-scan.js', note: 'aggressive scan: per-rule physical validation, categories, totals', ranges: [[2626, 2858]], imports: [IMP.path, IMP.fsp, IMP.crypto, 'import { isProtectedPath } from "./protected-roots.js";'], exports: ['scanRule', 'scanAggressive', 'validatedPhysicalRoot', 'hash'], renames: [['canonical$1', 'canonicalPath'], ['protectedRoots2', 'protectedRootsArg']] },
  { file: 'aggressive-controller.js', note: 'aggressive controller: candidate snapshot -> revalidate each file -> delete/empty/maintain', ranges: [[2859, 3190]], imports: [IMP.path, IMP.fsp, IMP.crypto, 'import { AtomicJsonStore, SerialExecutor } from "./storage.js";', 'import { validateAggressiveCleanRequest } from "./request-validators.js";', 'import { scanAggressive } from "./aggressive-scan.js";', 'import { discoverAggressiveRules } from "./aggressive-rules.js";', 'import { resolveProtectedRoots, isProtectedPath } from "./protected-roots.js";'], exports: ['AggressiveController', 'operationReason', 'resultStatus'] },
  { file: 'window.js', note: 'the single app window (frameless, sandboxed, navigation locked)', ranges: [[3191, 3237]], imports: [IMP.electron, IMP.path, IMP.url, 'import { getPreloadPath, getWindowIconPath, getWindowWebPreferences } from "./window-options.js";', IMP.moduleShim], exports: ['createWindow', 'mainWindow'] },
  {
    file: 'index.js',
    note: 'composition root: build every controller from the same env/paths, register IPC',
    ranges: [[3238, 3331]],
    imports: [IMP.electron, IMP.path, IMP.url, 'import { createDefaultRules } from "./rules.js";', 'import { evaluateRestoreTargetPath } from "./path-guard.js";', 'import { QuarantineService } from "./quarantine.js";', 'import { CleanerController } from "./cleaner-controller.js";', 'import { NativeSecureFileOperations } from "./native-delete.js";', 'import { PowerShellRunner } from "./powershell-runner.js";', 'import { AggressiveController } from "./aggressive-controller.js";', 'import { NativeAggressiveOperations } from "./aggressive-native.js";', 'import { MaintenanceProvider, NativeElevatedMaintenanceRunner } from "./maintenance.js";', 'import { SoftwareProvider } from "./software-provider.js";', 'import { WindowsUninstallProcessRunner, PowerShellAppxActionRunner, ExecFileProcessRunner, UninstallExecutor } from "./uninstall-executors.js";', 'import { NativeElevatedProcessRunner } from "./elevation.js";', 'import { SoftwareController } from "./software-controller.js";', 'import { StartupProvider } from "./startup-provider.js";', 'import { StartupController } from "./startup-controller.js";', 'import { StartupActions } from "./startup-actions.js";', 'import { NativeElevatedStartupRunner } from "./elevated-startup-runner.js";', 'import { createWindow } from "./window.js";', 'import { registerIpcHandlers, IPC_CHANNELS } from "./ipc.js";', 'import { PlanController } from "./plan-controller.js";', IMP.moduleShim],
    exports: []
  }
];

// NOTE: every module keeps the helper copies the bundle emitted for it (canonical$N etc.
// are renamed only where the suffix was an esbuild collision marker, never merged away).

function sliceLines(all, ranges, base = 1) {
  const parts = [];
  for (const [a, b] of ranges) {
    if (b < a) throw new Error(`bad range ${a}-${b}`);
    parts.push(all.slice(a - base, b - base + 1).join('\n'));
  }
  return parts.join('\n');
}

function applyRenames(body, renames) {
  let out = body;
  for (const [from, to] of renames ?? []) {
    out = out.replace(new RegExp(`\\b${from.replace(/\$/g, '\\$')}\\b`, 'g'), to);
  }
  return out;
}

const report = [];

// The repository has hand-written security fixes on top of the recovery (src/main/plan-controller.js,
// confirmation gates in the controllers, the .reg backup, the hardened PowerShell runner). Re-running
// this tool over a recovered tree would erase them, so it refuses unless --force is given.
if (!DRY && !flags.has('--force') && (fs.existsSync(path.join(repoRoot, 'src')) || fs.existsSync(path.join(repoRoot, 'scripts')))) {
  say('refusing to overwrite an existing src/ or scripts/ tree: this tool writes the raw recovery,');
  say('while the repository carries the audited version on top of it. Re-run with --force only if you');
  say('intend to redo the security fixes by hand (see docs/SOURCE-RECOVERY.md).');
  process.exit(4);
}

// ---- 1) main process ----------------------------------------------------
const mainBundlePath = path.join(extracted, 'out/main/main.js');
const mainLines = fs.readFileSync(mainBundlePath, 'utf8').split('\n');
say(`main bundle lines: ${mainLines.length}`);
const mainDir = path.join(repoRoot, 'src/main');
const writtenMain = [];
{
  // coverage guard: bundle body lines 14..3331 must appear in exactly one module
  const covered = new Map();
  const problems = [];
  for (const mod of MAIN_MANIFEST) {
    for (const [a, b] of mod.ranges) {
      for (let line = a; line <= b; line += 1) {
        if (covered.has(line)) problems.push(`line ${line} claimed by ${covered.get(line)} and ${mod.file}`);
        covered.set(line, mod.file);
      }
    }
  }
  for (let line = 14; line <= 3331; line += 1) if (!covered.has(line)) problems.push(`line ${line} not claimed`);
  if (problems.length) throw new Error(`main coverage broken:\n${problems.slice(0, 10).join('\n')}`);
  report.push('main coverage: bundle body lines 14-3331 map to exactly one module each');
}
for (const mod of [...MAIN_MANIFEST].sort((a, b) => a.file.localeCompare(b.file))) {
  const body = applyRenames(sliceLines(mainLines, mod.ranges), mod.renames);
  const header = [
    '/**',
    ` * ${mod.file} -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).`,
    ` * ${mod.note}.`,
    ' * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for',
    ' * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).',
    ' */',
    ...mod.imports,
    ''
  ].join('\n');
  const footer = mod.exports.length ? `\nexport {\n${mod.exports.map((e) => `  ${e}`).join(',\n')}\n};\n` : '\n';
  const target = path.join(mainDir, mod.file);
  if (!DRY) {
    fs.mkdirSync(mainDir, { recursive: true });
    fs.writeFileSync(target, header + body + '\n' + footer);
  }
  writtenMain.push(mod.file);
}
report.push(`main modules written: ${writtenMain.length} -> src/main/`);

// ---- 2) preload ---------------------------------------------------------
const preloadSrc = path.join(extracted, 'out/preload/preload.cjs');
const preloadDst = path.join(repoRoot, 'src/preload/preload.cjs');
if (!DRY) {
  fs.mkdirSync(path.dirname(preloadDst), { recursive: true });
  fs.copyFileSync(preloadSrc, preloadDst);
}
report.push('preload copied verbatim -> src/preload/preload.cjs');

// ---- 3) renderer --------------------------------------------------------
const rendererBundle = path.join(extracted, 'out/renderer/assets/index-BqZXxDE4.js');
const rLines = fs.readFileSync(rendererBundle, 'utf8').split('\n');
const appStart = rLines.findIndex((l) => l.startsWith('function getJingJieApi')) + 1;
if (appStart < 1) throw new Error('app region not found in renderer bundle');
say(`renderer bundle lines: ${rLines.length}, app region starts: ${appStart}`);
const vendorRegion = rLines.slice(0, appStart - 1);
const appRegion = rLines.slice(appStart - 1);

// which vendor top-level symbols does the app region actually reference?
const vendorDecls = [...vendorRegion.join('\n').matchAll(/^(?:const|let|var|function|async function) ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
const appText = appRegion.join('\n');
const appTokens = new Set([...appText.matchAll(/[A-Za-z0-9_$]+/g)].map((m) => m[0]));
const vendorNeeded = new Set(vendorDecls.filter((n) => appTokens.has(n)));

const rendererDir = path.join(repoRoot, 'src/renderer');
if (!DRY) {
  fs.mkdirSync(rendererDir, { recursive: true });
  const vendorOut = `${vendorRegion.join('\n')}\n\n// ---- recovered vendor chunk: react 19.2.8 + react-dom + scheduler + lucide-react ----\n` +
    `// Original Vite bundle kept these in one chunk; they are exported here so the recovered app modules can\n` +
    `// import them directly with no bundler and no install step. Do not hand-edit this file.\n` +
    `export {\n${[...vendorNeeded].map((n) => `  ${n},`).join('\n')}\n};\n`;
  fs.writeFileSync(path.join(rendererDir, 'vendor.js'), vendorOut);
}
report.push(`renderer vendor chunk: ${vendorRegion.length} lines, exports ${vendorNeeded.size} symbols -> src/renderer/vendor.js`);

// absolute line numbers inside the renderer bundle (verified against the top-level
// declaration list of the app region)
const RENDERER_MANIFEST = [
  { file: 'lib/app-info.js', ranges: [[12804, 12830]], note: 'bridge accessor, product constants, known-failure wording' },
  { file: 'components/Sidebar.js', ranges: [[12831, 12877]], note: 'primary navigation' },
  { file: 'lib/format.js', ranges: [[12878, 12888], [13084, 13094]], note: 'byte formatting helpers' },
  { file: 'components/ScanPanel.js', ranges: [[12889, 12962]], note: 'deep cleanup scan/clean control' },
  { file: 'components/MetricList.js', ranges: [[12963, 12991]], note: 'detected categories per rule' },
  { file: 'components/ResultsPanel.js', ranges: [[12992, 13010]], note: 'cleanup result banner' },
  { file: 'components/QuarantinePanel.js', ranges: [[13011, 13053]], note: 'quarantine list + restore' },
  { file: 'components/HistoryPanel.js', ranges: [[13054, 13082]], note: 'history list' },
  { file: 'lib/software.js', ranges: [[13083, 13083], [13095, 13125]], note: 'uninstall labels, failure wording, report merge' },
  { file: 'components/SoftwarePanel.js', ranges: [[13126, 13419]], note: 'software ledger + uninstall flow' },
  { file: 'components/StartupPanel.js', ranges: [[13420, 13603]], note: 'startup entries + restore' },
  { file: 'components/AggressivePanel.js', ranges: [[13604, 13903]], note: 'aggressive cleanup' },
  { file: 'app.js', ranges: [[13904, rLines.length]], note: 'root component: view routing, cleanup orchestration, about dialog' }
];

// coverage guard: every line of the app region must land in exactly one module
{
  const covered = new Map();
  const problems = [];
  for (const mod of RENDERER_MANIFEST) {
    for (const [a, b] of mod.ranges) {
      for (let line = a; line <= b; line += 1) {
        if (covered.has(line)) problems.push(`line ${line} claimed by ${covered.get(line)} and ${mod.file}`);
        covered.set(line, mod.file);
      }
    }
  }
  for (let line = appStart; line <= rLines.length; line += 1) {
    if (!covered.has(line)) problems.push(`line ${line} not claimed by any renderer module`);
  }
  if (problems.length) throw new Error(`renderer coverage broken:\n${problems.slice(0, 10).join('\n')}`);
  report.push(`renderer coverage: all ${rLines.length - appStart + 1} app-region lines land in exactly one module`);
}

const DECL_RE = /^(?:const|let|function|async function|class) ([A-Za-z0-9_$]+)/gm;
const importPath = (fromFile, toFile) => {
  const rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return rel.startsWith('..') ? rel : `./${rel}`;
};

// build a symbol -> module table so imports can be emitted mechanically
const symbolModule = new Map();
for (const mod of RENDERER_MANIFEST) {
  mod.body = sliceLines(appRegion, mod.ranges, appStart);
  for (const m of mod.body.matchAll(DECL_RE)) symbolModule.set(m[1], mod.file);
}
for (const mod of RENDERER_MANIFEST) {
  const own = new Set([...mod.body.matchAll(DECL_RE)].map((m) => m[1]));
  const used = new Set();
  for (const token of mod.body.matchAll(/[A-Za-z0-9_$]+/g)) {
    const name = token[0];
    if (own.has(name)) continue;
    if (vendorNeeded.has(name) || (symbolModule.has(name) && symbolModule.get(name) !== mod.file)) used.add(name);
  }
  const fromVendor = [...used].filter((n) => vendorNeeded.has(n)).sort();
  const groups = new Map();
  for (const n of used) {
    if (fromVendor.includes(n)) continue;
    const target = importPath(mod.file, symbolModule.get(n));
    if (!groups.has(target)) groups.set(target, new Set());
    groups.get(target).add(n);
  }
  const importLines = [];
  if (fromVendor.length) importLines.push(`import { ${fromVendor.join(', ')} } from "${importPath(mod.file, 'vendor.js')}";`);
  for (const [target, names] of [...groups.entries()].sort()) importLines.push(`import { ${[...names].sort().join(', ')} } from "${target}";`);
  mod.importLines = importLines;
  const header = [
    '/**',
    ` * ${mod.file} -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).`,
    ` * ${mod.note}.`,
    ' * The bundle kept the original function and variable names; JSX was already compiled to',
    ' * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against',
    ' * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.',
    ' */',
    ...importLines,
    ''
  ].join('\n');
  if (!DRY) {
    const target = path.join(rendererDir, mod.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, header + mod.body + '\n');
  }
}
report.push(`renderer app modules: ${RENDERER_MANIFEST.length} -> src/renderer/`);

// ---- 4) html / css / win-controls / providers --------------------------
if (!DRY) {
  fs.copyFileSync(path.join(extracted, 'out/renderer/index.html'), path.join(rendererDir, 'index.html'));
  const css = fs.readdirSync(path.join(extracted, 'out/renderer/assets')).find((f) => f.endsWith('.css'));
  fs.copyFileSync(path.join(extracted, 'out/renderer/assets', css), path.join(rendererDir, 'styles.css'));
  fs.copyFileSync(path.join(extracted, 'out/renderer/assets/win-controls.js'), path.join(rendererDir, 'win-controls.js'));
  if (providersDir) {
    fs.mkdirSync(path.join(repoRoot, 'scripts/providers'), { recursive: true });
    for (const f of fs.readdirSync(providersDir)) fs.copyFileSync(path.join(providersDir, f), path.join(repoRoot, 'scripts/providers', f));
    report.push(`provider scripts copied from ${providersDir} -> scripts/providers/`);
  }
}
report.push(`renderer styles copied -> src/renderer/styles.css (+ index.html, win-controls.js)`);

for (const line of report) say(line);
say(DRY ? 'DRY RUN - nothing written' : 'recovery complete');
