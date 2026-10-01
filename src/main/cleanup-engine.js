/**
 * cleanup-engine.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * scan -> revalidate -> delete/quarantine, per-item result ledger.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { evaluatePath, evaluatePhysicalPath, evaluatePhysicalRuleRoot, trustedRuleAnchor } from "./path-guard.js";
function errorReasonOf(error) {
  if (typeof error === "object" && error && "code" in error) return String(error.code).toLocaleLowerCase("en-US");
  if (error instanceof Error && error.message) return error.message;
  return "unknown-error";
}
async function executeCleanup(items, context) {
  const startedAt = (context.now ?? /* @__PURE__ */ new Date()).toISOString();
  const taskId = context.taskId ?? randomUUID();
  const scanTaskId = context.scanTaskId ?? taskId;
  const clockStartedAt = Date.now();
  const rules = new Map(context.rules.map((rule) => [rule.id, rule]));
  const results = [];
  let freedBytes = 0;
  let quarantinedBytes = 0;
  let currentRuleId;
  const progress = async (phase) => {
    const processedCount = results.length;
    const succeededCount2 = results.filter((result) => result.status === "succeeded").length;
    const elapsedMs = Date.now() - clockStartedAt;
    const estimatedRemainingMs = processedCount > 0 && processedCount < items.length ? Math.max(0, Math.round(elapsedMs / processedCount * (items.length - processedCount))) : void 0;
    await context.onProgress?.({
      jobId: taskId,
      scanTaskId,
      phase,
      processedCount,
      totalCount: items.length,
      succeededCount: succeededCount2,
      failedCount: processedCount - succeededCount2,
      freedBytes,
      currentRuleId,
      estimatedRemainingMs
    });
  };
  const record = async (result) => {
    results.push(result);
    await context.onResult?.(result);
    await progress("deleting");
  };
  await progress("starting");
  const deleteSession = items.some((item) => item.mode === "delete") ? await context.fileOperations.openSession?.() : void 0;
  try {
    for (const item of items) {
      if (context.signal?.aborted) break;
      currentRuleId = item.ruleId;
      const rule = rules.get(item.ruleId);
      if (!rule) {
        await record({ itemId: item.id, status: "skipped", reason: "unknown-rule" });
        continue;
      }
      if (rule.mode !== item.mode) {
        await record({ itemId: item.id, status: "skipped", reason: "mode-mismatch" });
        continue;
      }
      try {
        await context.onItemStart?.(item);
        const stats = await lstat(item.path);
        const decision = stats.isSymbolicLink() ? { allowed: false, reason: "symbolic-link" } : await evaluatePhysicalPath(item.path, rule, context.env);
        if (!decision.allowed) {
          await record({ itemId: item.id, status: "skipped", reason: decision.reason });
          continue;
        }
        if (!stats.isFile() || stats.size !== item.sizeBytes || stats.mtime.toISOString() !== item.modifiedAt) {
          await record({ itemId: item.id, status: "skipped", reason: "changed-since-scan" });
          continue;
        }
        if (rule.mode === "delete") {
          await (deleteSession ?? context.fileOperations).deleteFile({
            anchorPath: trustedRuleAnchor(rule, context.env),
            ruleRoot: rule.root,
            targetPath: decision.normalizedPath,
            expectedSize: item.sizeBytes,
            expectedModifiedAt: item.modifiedAt
          });
          freedBytes += item.sizeBytes;
        } else {
          await context.quarantine.quarantine(item);
          quarantinedBytes += item.sizeBytes;
        }
        await record({ itemId: item.id, status: "succeeded", action: rule.mode });
      } catch (error) {
        await record({ itemId: item.id, status: "failed", reason: errorReasonOf(error) });
      }
    }
  } finally {
    await deleteSession?.close();
  }
  const succeededCount = results.filter((result) => result.status === "succeeded").length;
  const cancelled = context.signal?.aborted === true && results.length < items.length;
  await progress(cancelled ? "cancelled" : "completed");
  return {
    taskId,
    requestedCount: items.length,
    succeededCount,
    failedCount: results.length - succeededCount,
    freedBytes,
    quarantinedBytes,
    cancelled,
    results,
    startedAt,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function itemId(ruleId, filePath, size, modifiedMs) {
  return createHash("sha256").update(`${ruleId}\0${filePath}\0${size}\0${modifiedMs}`).digest("hex").slice(0, 24);
}
function errorReason(error) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown-error";
  if (code === "ENOENT") return "not-found";
  if (code === "EACCES" || code === "EPERM") return "permission-denied";
  return code.toLocaleLowerCase("en-US");
}
async function scanRules(rules, options) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const now = options.now ?? /* @__PURE__ */ new Date();
  const items = [];
  const skipped = [];
  const categories = rules.filter((rule) => rule.enabled).map((rule) => ({
    ruleId: rule.id,
    label: rule.label,
    mode: rule.mode,
    itemCount: 0,
    sizeBytes: 0,
    skippedCount: 0
  }));
  const categoryByRule = new Map(categories.map((category) => [category.ruleId, category]));
  let visited = 0;
  let cancelled = false;
  const physicalRoots = /* @__PURE__ */ new Map();
  const recordSkip = (rule, filePath, reason) => {
    skipped.push({ ruleId: rule.id, path: filePath, reason });
    const category = categoryByRule.get(rule.id);
    if (category) category.skippedCount += 1;
  };
  const walk = async (directory, rule) => {
    if (options.signal?.aborted) {
      cancelled = true;
      return;
    }
    let handle;
    try {
      handle = await opendir(directory);
    } catch (error) {
      recordSkip(rule, directory, errorReason(error));
      return;
    }
    try {
      for await (const entry of handle) {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        const candidate = `${directory}\\${entry.name}`;
        let stats;
        try {
          stats = await lstat(candidate);
        } catch (error) {
          recordSkip(rule, candidate, errorReason(error));
          continue;
        }
        const decision = stats.isSymbolicLink() ? { allowed: false, reason: "symbolic-link" } : evaluatePath(candidate, rule, options.env);
        if (!decision.allowed) {
          recordSkip(rule, candidate, decision.reason);
          continue;
        }
        if (stats.isDirectory()) {
          const physicalRoot = physicalRoots.get(rule.id);
          const physicalCandidate = await realpath(decision.normalizedPath);
          const physicalRelative = physicalRoot ? relative(physicalRoot, physicalCandidate) : "..";
          if (physicalRelative.startsWith("..") || isAbsolute(physicalRelative)) {
            recordSkip(rule, candidate, "outside-rule-root");
            continue;
          }
          await walk(decision.normalizedPath, rule);
        } else if (stats.isFile()) {
          const ageMs = now.getTime() - stats.mtimeMs;
          if (ageMs >= rule.minAgeHours * 60 * 60 * 1e3) {
            const item = {
              id: itemId(rule.id, decision.normalizedPath, stats.size, stats.mtimeMs),
              ruleId: rule.id,
              category: rule.label,
              path: decision.normalizedPath,
              relativePath: relative(rule.root, decision.normalizedPath),
              sizeBytes: stats.size,
              modifiedAt: stats.mtime.toISOString(),
              mode: rule.mode
            };
            items.push(item);
            const category = categoryByRule.get(rule.id);
            if (category) {
              category.itemCount += 1;
              category.sizeBytes += stats.size;
            }
          }
        }
        visited += 1;
        if (visited % (options.yieldEvery ?? 100) === 0) {
          await new Promise((resolve2) => setImmediate(resolve2));
        }
      }
    } catch (error) {
      recordSkip(rule, directory, errorReason(error));
    }
  };
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    try {
      const rootDecision = await evaluatePhysicalRuleRoot(rule, options.env);
      if (!rootDecision.allowed) {
        recordSkip(rule, rule.root, rootDecision.reason);
        continue;
      }
      physicalRoots.set(rule.id, await realpath(rootDecision.normalizedPath));
      await walk(rootDecision.normalizedPath, rule);
    } catch (error) {
      recordSkip(rule, rule.root, errorReason(error));
    }
  }
  return {
    taskId: randomUUID(),
    items,
    categories,
    skipped,
    totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    cancelled,
    startedAt,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

export {
  executeCleanup,
  scanRules,
  itemId,
  errorReason
};
