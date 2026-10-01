/**
 * aggressive-scan.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * aggressive scan: per-rule physical validation, categories, totals.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { isProtectedPath } from "./protected-roots.js";
const CATEGORY_LABELS = {
  "application-cache": "应用缓存",
  "system-cache": "系统缓存",
  "developer-cache": "开发者缓存",
  "recycle-bin": "回收站",
  "windows-maintenance": "Windows 维护"
};
function canonicalPath(value) {
  const withoutPrefix = value.startsWith("\\\\?\\UNC\\") ? `\\\\${value.slice(8)}` : value.startsWith("\\\\?\\") ? value.slice(4) : value;
  return win32.resolve(withoutPrefix).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}
function isAtOrBelow(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}\\`);
}
function hash(parts) {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
}
function emptyCategories() {
  return Object.keys(CATEGORY_LABELS).map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
    candidateIds: [],
    sizeBytes: 0,
    itemCount: 0,
    status: "empty"
  }));
}
async function validatedPhysicalRoot(rule, protectedRootsArg) {
  if (!win32.isAbsolute(rule.anchorPath) || !win32.isAbsolute(rule.root)) return void 0;
  const relativeRoot = win32.relative(rule.anchorPath, rule.root);
  if (!relativeRoot || relativeRoot.startsWith("..") || win32.isAbsolute(relativeRoot)) return void 0;
  if (isProtectedPath(rule.root, protectedRootsArg)) return void 0;
  let current = win32.resolve(rule.anchorPath);
  const chain = [current];
  for (const segment of relativeRoot.split("\\").filter(Boolean)) {
    current = win32.join(current, segment);
    chain.push(current);
  }
  try {
    for (const directory of chain) {
      const stats = await lstat(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return void 0;
    }
    const [physicalAnchor, physicalRoot] = await Promise.all([realpath(rule.anchorPath), realpath(rule.root)]);
    if (!isAtOrBelow(canonicalPath(physicalRoot), canonicalPath(physicalAnchor))) return void 0;
    if (isProtectedPath(physicalRoot, protectedRootsArg)) return void 0;
    return physicalRoot;
  } catch {
    return void 0;
  }
}
async function scanRule(rule, options, onVisit) {
  const physicalRoot = await validatedPhysicalRoot(rule, options.protectedRoots);
  if (!physicalRoot) return [];
  const files = [];
  const nowMs = (options.now ?? /* @__PURE__ */ new Date()).getTime();
  const walk = async (directory) => {
    if (options.signal?.aborted) return;
    let handle;
    try {
      handle = await opendir(directory);
    } catch {
      return;
    }
    try {
      for await (const entry of handle) {
        if (options.signal?.aborted) break;
        const candidate = win32.join(directory, entry.name);
        let stats;
        try {
          stats = await lstat(candidate);
        } catch {
          continue;
        }
        if (stats.isSymbolicLink() || isProtectedPath(candidate, options.protectedRoots)) continue;
        if (stats.isDirectory()) {
          let physicalCandidate;
          try {
            physicalCandidate = await realpath(candidate);
          } catch {
            continue;
          }
          if (!isAtOrBelow(canonicalPath(physicalCandidate), canonicalPath(physicalRoot))) continue;
          if (isProtectedPath(physicalCandidate, options.protectedRoots)) continue;
          await walk(candidate);
        } else if (stats.isFile()) {
          if (rule.fileNamePattern && !rule.fileNamePattern.test(entry.name)) continue;
          const ageMs = nowMs - stats.mtimeMs;
          if (ageMs < rule.minAgeHours * 60 * 60 * 1e3) continue;
          files.push({
            id: hash([rule.id, candidate, stats.size, stats.mtimeMs]),
            ruleId: rule.id,
            nativeRuleId: rule.nativeRuleId,
            anchorPath: rule.anchorPath,
            ruleRoot: rule.root,
            path: candidate,
            sizeBytes: stats.size,
            modifiedAt: stats.mtime.toISOString()
          });
        }
        await onVisit();
      }
    } catch {
    }
  };
  await walk(rule.root);
  return files.sort((left, right) => left.path.localeCompare(right.path, "en-US"));
}
function addToCategory(category, candidate) {
  category.candidateIds.push(candidate.view.id);
  category.sizeBytes += candidate.view.sizeBytes;
  category.itemCount += candidate.view.itemCount;
  category.status = "ready";
}
async function scanAggressive(options) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const categories = emptyCategories();
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const candidates = [];
  let visited = 0;
  const onVisit = async () => {
    visited += 1;
    if (visited % (options.yieldEvery ?? 100) === 0) await new Promise((resolve2) => setImmediate(resolve2));
  };
  if (!options.signal?.aborted) {
    for (const rule of options.rules) {
      if (options.signal?.aborted) break;
      const files = await scanRule(rule, options, onVisit);
      if (!files.length) continue;
      const view = {
        id: `files-${hash([rule.id, ...files.map((file) => file.id)])}`,
        categoryId: rule.categoryId,
        kind: "file-cache",
        label: rule.label,
        sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        itemCount: files.length,
        impact: rule.impact,
        preservationSummary: rule.preservationSummary,
        privilege: "user",
        selectedByDefault: true,
        sizeIsEstimate: false
      };
      const candidate = { view, kind: "file-cache", files };
      candidates.push(candidate);
      addToCategory(categoryById.get(rule.categoryId), candidate);
    }
  }
  if (!options.signal?.aborted) {
    try {
      const recycle = await options.recycleBin.queryRecycleBin();
      if (Number.isSafeInteger(recycle.itemCount) && recycle.itemCount > 0 && Number.isSafeInteger(recycle.sizeBytes) && recycle.sizeBytes >= 0) {
        const candidate = {
          kind: "recycle-bin",
          view: {
            id: "recycle-bin",
            categoryId: "recycle-bin",
            kind: "recycle-bin",
            label: "回收站",
            sizeBytes: recycle.sizeBytes,
            itemCount: recycle.itemCount,
            impact: "永久清空回收站，内容无法通过净界恢复",
            preservationSummary: "不触碰桌面、文档、下载及其他个人目录",
            privilege: "user",
            // SECURITY-REVIEW S-03: an action whose own description says "永久清空回收站，内容无法
            // 通过净界恢复" must never be pre-selected. It is still offered -- just not checked.
            selectedByDefault: false,
            sizeIsEstimate: false
          }
        };
        candidates.push(candidate);
        addToCategory(categoryById.get("recycle-bin"), candidate);
      }
    } catch {
      Object.assign(categoryById.get("recycle-bin"), { status: "unsupported", message: "当前无法读取回收站" });
    }
  }
  if (!options.signal?.aborted) {
    try {
      const maintenance = await options.maintenance.probe();
      const unsupported = maintenance.filter((item) => !item.supported);
      for (const item of maintenance.filter((candidate) => candidate.supported)) {
        const candidate = {
          kind: "system-action",
          actionId: item.actionId,
          view: {
            id: `maintenance-${item.actionId}`,
            categoryId: "windows-maintenance",
            kind: "system-action",
            label: item.label,
            sizeBytes: item.sizeBytes,
            itemCount: 1,
            impact: item.impact,
            preservationSummary: item.preservationSummary,
            privilege: "administrator",
            selectedByDefault: true,
            sizeIsEstimate: item.sizeIsEstimate
          }
        };
        candidates.push(candidate);
        addToCategory(categoryById.get("windows-maintenance"), candidate);
      }
      if (!maintenance.some((item) => item.supported) && unsupported.length) {
        Object.assign(categoryById.get("windows-maintenance"), {
          status: "unsupported",
          message: unsupported[0].unavailableReason ?? "当前系统不支持"
        });
      }
    } catch {
      Object.assign(categoryById.get("windows-maintenance"), { status: "unsupported", message: "当前无法检查系统维护能力" });
    }
  }
  const cancelled = options.signal?.aborted ?? false;
  if (cancelled) {
    candidates.length = 0;
    for (const category of categories) Object.assign(category, { candidateIds: [], sizeBytes: 0, itemCount: 0, status: "empty" });
  }
  const report = {
    taskId: randomUUID(),
    candidates: candidates.map((candidate) => structuredClone(candidate.view)),
    categories,
    totalBytes: candidates.reduce((sum, candidate) => sum + candidate.view.sizeBytes, 0),
    totalItemCount: candidates.reduce((sum, candidate) => sum + candidate.view.itemCount, 0),
    protectedSummary: {
      personalFolders: options.protectedRoots.personalFolders.length,
      cloudRoots: options.protectedRoots.cloudRoots.length,
      browserData: true,
      applicationData: true,
      windowsCore: true
    },
    cancelled,
    startedAt,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  return { report, candidates };
}

export {
  scanRule,
  scanAggressive,
  validatedPhysicalRoot,
  hash
};
