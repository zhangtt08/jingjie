/**
 * aggressive-controller.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * aggressive controller: candidate snapshot -> revalidate each file -> delete/empty/maintain.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { AtomicJsonStore, SerialExecutor } from "./storage.js";
import { validateAggressiveCleanRequest, assertConfirmed } from "./request-validators.js";
import { scanAggressive } from "./aggressive-scan.js";
import { discoverAggressiveRules } from "./aggressive-rules.js";
import { resolveProtectedRoots, isProtectedPath } from "./protected-roots.js";
function canonical(value) {
  return win32.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}
function operationReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLocaleLowerCase("en-US");
  // 文件已经不在了（上一次重试删掉了 / 用户自己清了）不是失败，也不能算"我删的"：如实报 not-found。
  if (/enoent|no such file/.test(lower)) return "not-found";
  if (/eacces|eperm|access.*denied|permission/.test(lower)) return "permission-denied";
  if (/ebusy|locked|sharing violation|being used/.test(lower)) return "software-locked";
  if (/changed-since-scan/.test(lower)) return "changed-since-scan";
  if (/protected-root|outside-rule-root|symbolic-link|unsafe-rule-root/.test(lower)) return lower.match(/protected-root|outside-rule-root|symbolic-link|unsafe-rule-root/)?.[0] ?? "safety-check-failed";
  return message || "operation-failed";
}
function resultStatus(reason) {
  return /permission-denied|software-locked|changed-since-scan|not-found|protected-root|outside-rule-root|symbolic-link|unsafe-rule-root/.test(reason) ? "skipped" : "failed";
}
const LEDGER_PATH_SAMPLE = 20;
/** bounded, display-only projection of a candidate list for the persisted job ledger */
function summarizeCandidatesForLedger(candidates) {
  return candidates.map((candidate) => ({
    view: structuredClone(candidate.view),
    kind: candidate.kind,
    fileCount: candidate.files?.length ?? 0,
    pathSample: (candidate.files ?? []).slice(0, LEDGER_PATH_SAMPLE).map((file) => file.path)
  }));
}
class AggressiveController {
  constructor(options) {
    this.options = options;
    this.history = new AtomicJsonStore(options.historyPath, []);
    this.jobs = new AtomicJsonStore(`${options.historyPath}.jobs`, []);
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.ruleProvider = options.ruleProvider ?? ((roots) => discoverAggressiveRules(options.env, roots));
    this.ready = this.jobs.update((jobs) => jobs.map((job) => job.status === "in-progress" ? {
      ...job,
      status: "interrupted",
      finishedAt: this.now().toISOString(),
      failureReason: "application-restarted"
    } : job));
  }
  options;
  history;
  jobs;
  now;
  ruleProvider;
  ready;
  destructive = new SerialExecutor();
  snapshots = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  activeScan;
  activeCleanup;
  progress;
  nonInterruptible = false;
  async scan() {
    await this.ready;
    if (this.activeScan) throw new Error("scan-in-progress");
    // SECURITY-REVIEW S-04: without the native helper there is no protected-root manifest and
    // no recycle-bin query, so the scan must refuse rather than guess a boundary.
    if (!this.options.native) throw new Error("fs-helper-missing");
    const abort = new AbortController();
    this.activeScan = abort;
    try {
      const roots = await this.currentProtectedRoots();
      const rules = await this.ruleProvider(roots);
      const { report, candidates } = await scanAggressive({
        rules,
        protectedRoots: roots,
        recycleBin: this.options.native,
        maintenance: this.options.maintenance,
        now: this.now(),
        signal: abort.signal
      });
      if (!report.cancelled) this.snapshots.set(report.taskId, {
        report,
        candidates,
        // 与 CleanerController 同一套 remaining 语义：没成功的候选留在快照里才能重试。
        remaining: new Set(report.candidates.map((candidate) => candidate.id)),
        expiresAt: this.now().getTime() + 15 * 60 * 1e3
      });
      return report;
    } finally {
      this.activeScan = void 0;
    }
  }
  /**
   * Read-only: the per-file list behind one `files-*` candidate of a live snapshot.
   * Added for the plan preview (docs/PRODUCT-REVIEW.md) -- the shipped app only ever showed
   * a size per category, so "which files exactly" could not be reviewed before deleting.
   */
  candidateFiles(candidateId) {
    if (typeof candidateId !== "string" || candidateId.length > 128) throw new Error("invalid-id");
    for (const snapshot of this.snapshots.values()) {
      const candidate = snapshot.candidates.find((entry) => entry.view.id === candidateId);
      if (candidate && candidate.kind === "file-cache") return candidate.files.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes, modifiedAt: file.modifiedAt }));
    }
    return [];
  }
  cancelScan() {
    if (!this.activeScan || this.activeScan.signal.aborted) return false;
    this.activeScan.abort();
    return true;
  }
  clean(value) {
    const request = validateAggressiveCleanRequest(value);
    // SECURITY-REVIEW S-02 + S-03: confirmation is mandatory, and emptying the recycle bin
    // additionally needs an explicit acknowledgement that its contents cannot come back.
    assertConfirmed(request, "confirmation-required");
    return this.destructive.run(() => this.cleanExclusive(request));
  }
  cancelCleanup() {
    if (!this.activeCleanup || this.activeCleanup.signal.aborted) return false;
    this.activeCleanup.abort();
    if (this.progress) this.publish({
      ...this.progress,
      phase: "cancelling",
      cancellationPending: this.nonInterruptible || void 0
    });
    return true;
  }
  getProgress() {
    return this.progress ? structuredClone(this.progress) : void 0;
  }
  onProgress(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getHistory() {
    return this.history.read();
  }
  async currentProtectedRoots() {
    return resolveProtectedRoots(await this.options.native.getProtectedRoots());
  }
  publish(progress) {
    this.progress = structuredClone(progress);
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(progress));
      } catch {
      }
    }
  }
  async validateFile(item, roots, rules) {
    const rule = rules.get(item.ruleId);
    if (!rule || canonical(rule.root) !== canonical(item.ruleRoot) || rule.nativeRuleId !== item.nativeRuleId) return "unsafe-rule-root";
    if (isProtectedPath(item.ruleRoot, roots) || isProtectedPath(item.path, roots)) return "protected-root";
    try {
      const stats = await lstat(item.path);
      if (!stats.isFile() || stats.isSymbolicLink()) return "symbolic-link";
      if (stats.size !== item.sizeBytes || Math.abs(stats.mtimeMs - Date.parse(item.modifiedAt)) > 2) return "changed-since-scan";
      if (isProtectedPath(await realpath(item.path), roots)) return "protected-root";
      return void 0;
    } catch (error) {
      return operationReason(error);
    }
  }
  async cleanExclusive(request) {
    await this.ready;
    const snapshot = this.snapshots.get(request.taskId);
    if (!snapshot) throw new Error("unknown-task");
    if (snapshot.expiresAt <= this.now().getTime()) {
      this.snapshots.delete(request.taskId);
      throw new Error("expired-task");
    }
    const byId = new Map(snapshot.candidates.map((candidate) => [candidate.view.id, candidate]));
    const selected = request.itemIds.map((id) => {
      const candidate = byId.get(id);
      if (!candidate) throw new Error("unknown-item");
      return candidate;
    });
    // SECURITY-REVIEW S-03: recycle-bin is the only candidate whose effect cannot be undone by
    // this app, so it needs its own acknowledgement on top of the generic confirmation.
    if (selected.some((candidate) => candidate.kind === "recycle-bin") && request.irreversibleAck !== true) {
      throw new Error("irreversible-acknowledgement-required");
    }
    this.snapshots.delete(request.taskId);
    const ordered = [
      ...selected.filter((candidate) => candidate.kind === "file-cache"),
      ...selected.filter((candidate) => candidate.kind === "recycle-bin"),
      ...selected.filter((candidate) => candidate.kind === "system-action")
    ];
    const jobId = randomUUID();
    const startedAt = this.now().toISOString();
    const job = {
      id: jobId,
      scanTaskId: request.taskId,
      status: "in-progress",
      candidateIds: request.itemIds,
      // SECURITY-REVIEW S-05 / defect D-01: the shipped code persisted structuredClone(ordered),
      // i.e. every file path of every candidate, into the jobs ledger. On this machine that file
      // grew to 23 MB and the whole array is rewritten on every checkpoint. The ledger keeps the
      // candidate views plus a bounded path sample; the full list lives in the scan snapshot.
      plan: summarizeCandidatesForLedger(ordered),
      results: [],
      startedAt
    };
    await this.jobs.update((jobs) => [job, ...jobs].slice(0, 50));
    const abort = new AbortController();
    this.activeCleanup = abort;
    const totalCount = ordered.reduce((sum, candidate) => sum + (candidate.kind === "file-cache" ? candidate.files.length : 1), 0);
    let state = {
      jobId,
      scanTaskId: request.taskId,
      phase: "starting",
      processedCount: 0,
      totalCount,
      succeededCount: 0,
      skippedCount: 0,
      failedCount: 0,
      freedBytes: 0
    };
    this.publish(state);
    const publishPatch = (patch) => {
      state = { ...state, ...patch };
      this.publish(abort.signal.aborted && state.phase !== "completed" && state.phase !== "cancelled" ? { ...state, phase: "cancelling", cancellationPending: this.nonInterruptible || void 0 } : state);
    };
    let permissionDeniedCount = 0;
    let lockedCount = 0;
    let restartRequiredCount = 0;
    let resultsSinceCheckpoint = 0;
    let lastCheckpointAt = Date.now();
    const persist = async (force = false) => {
      if (!force && resultsSinceCheckpoint < 50 && Date.now() - lastCheckpointAt < 1e3) return;
      resultsSinceCheckpoint = 0;
      lastCheckpointAt = Date.now();
      await this.jobs.update((jobs) => jobs.map((candidate) => candidate.id === jobId ? structuredClone(job) : candidate));
    };
    const record = async (result) => {
      job.results.push(result);
      resultsSinceCheckpoint += Math.max(1, result.processedCount);
      await persist();
    };
    try {
      const roots = await this.currentProtectedRoots();
      const currentRules = new Map((await this.ruleProvider(roots)).map((rule) => [rule.id, rule]));
      const protectedManifest = [...roots.personalFolders, ...roots.cloudRoots, ...roots.physicalRoots];
      const fileCandidates = ordered.filter((candidate) => candidate.kind === "file-cache");
      if (fileCandidates.length && !abort.signal.aborted) {
        const session = await this.options.native.openDeleteSession(protectedManifest);
        try {
          for (const candidate of fileCandidates) {
            let succeeded = 0;
            let skipped = 0;
            let failed = 0;
            let freed = 0;
            let firstReason;
            for (const item of candidate.files) {
              if (abort.signal.aborted) break;
              publishPatch({ phase: "file-cache", currentCategoryId: candidate.view.categoryId });
              const validationReason = await this.validateFile(item, roots, currentRules);
              let outcome = "succeeded";
              let reason = validationReason;
              if (!reason) {
                try {
                  await session.deleteFile({
                    nativeRuleId: item.nativeRuleId,
                    anchorPath: item.anchorPath,
                    ruleRoot: item.ruleRoot,
                    targetPath: item.path,
                    expectedSize: item.sizeBytes,
                    expectedModifiedAt: item.modifiedAt
                  });
                  succeeded += 1;
                  freed += item.sizeBytes;
                } catch (error) {
                  reason = operationReason(error);
                  outcome = resultStatus(reason);
                }
              } else {
                outcome = resultStatus(reason);
              }
              if (outcome === "skipped") skipped += 1;
              if (outcome === "failed") failed += 1;
              if (reason === "permission-denied") permissionDeniedCount += 1;
              if (reason === "software-locked") lockedCount += 1;
              firstReason ??= reason;
              publishPatch({
                processedCount: state.processedCount + 1,
                succeededCount: state.succeededCount + (outcome === "succeeded" ? 1 : 0),
                skippedCount: state.skippedCount + (outcome === "skipped" ? 1 : 0),
                failedCount: state.failedCount + (outcome === "failed" ? 1 : 0),
                freedBytes: state.freedBytes + (outcome === "succeeded" ? item.sizeBytes : 0)
              });
            }
            const processed = succeeded + skipped + failed;
            if (processed) await record({
              candidateId: candidate.view.id,
              kind: "file-cache",
              status: failed ? "failed" : succeeded ? "succeeded" : "skipped",
              processedCount: processed,
              freedBytes: freed,
              reason: firstReason ?? (skipped ? "partial-skip" : void 0),
              restartRequired: false
            });
            if (abort.signal.aborted) break;
          }
        } finally {
          await session.close();
        }
      }
      const recycleCandidate = ordered.find((candidate) => candidate.kind === "recycle-bin");
      if (recycleCandidate && !abort.signal.aborted) {
        publishPatch({ phase: "recycle-bin", currentCategoryId: "recycle-bin", currentActionId: "recycle-bin" });
        this.nonInterruptible = true;
        try {
          await this.options.native.emptyRecycleBin();
          publishPatch({ processedCount: state.processedCount + 1, succeededCount: state.succeededCount + 1, freedBytes: state.freedBytes + recycleCandidate.view.sizeBytes });
          await record({ candidateId: recycleCandidate.view.id, kind: "recycle-bin", status: "succeeded", processedCount: 1, freedBytes: recycleCandidate.view.sizeBytes, restartRequired: false });
        } catch (error) {
          const reason = operationReason(error);
          const status = resultStatus(reason);
          if (reason === "permission-denied") permissionDeniedCount += 1;
          publishPatch({ processedCount: state.processedCount + 1, [`${status}Count`]: state[`${status}Count`] + 1 });
          await record({ candidateId: recycleCandidate.view.id, kind: "recycle-bin", status, processedCount: 1, freedBytes: 0, reason, restartRequired: false });
        } finally {
          this.nonInterruptible = false;
        }
      }
      const maintenanceCandidates = ordered.filter((candidate) => candidate.kind === "system-action");
      for (const candidate of maintenanceCandidates) {
        if (abort.signal.aborted) break;
        publishPatch({ phase: "system-maintenance", currentCategoryId: "windows-maintenance", currentActionId: candidate.actionId });
        this.nonInterruptible = true;
        try {
          const maintenanceResults = await this.options.maintenance.execute([candidate.actionId]);
          const action = maintenanceResults[0] ?? { actionId: candidate.actionId, status: "failed", reason: "missing-maintenance-result", restartRequired: false };
          if (action.actionId !== candidate.actionId) throw new Error("invalid-maintenance-result");
          if (action.reason === "permission-denied") permissionDeniedCount += 1;
          if (action.restartRequired) restartRequiredCount += 1;
          const status = action.status;
          const freed = status === "succeeded" ? candidate.view.sizeBytes : 0;
          publishPatch({
            currentActionId: candidate.actionId,
            processedCount: state.processedCount + 1,
            succeededCount: state.succeededCount + (status === "succeeded" ? 1 : 0),
            skippedCount: state.skippedCount + (status === "skipped" ? 1 : 0),
            failedCount: state.failedCount + (status === "failed" ? 1 : 0),
            freedBytes: state.freedBytes + freed
          });
          await record({ candidateId: candidate.view.id, kind: "system-action", status, processedCount: 1, freedBytes: freed, reason: action.reason, restartRequired: action.restartRequired });
        } finally {
          this.nonInterruptible = false;
        }
      }
      const report = {
        taskId: jobId,
        scanTaskId: request.taskId,
        requestedCount: selected.length,
        succeededCount: job.results.filter((result) => result.status === "succeeded").length,
        skippedCount: job.results.filter((result) => result.status === "skipped").length,
        failedCount: job.results.filter((result) => result.status === "failed").length,
        permissionDeniedCount,
        lockedCount,
        restartRequiredCount,
        freedBytes: state.freedBytes,
        cancelled: abort.signal.aborted,
        results: structuredClone(job.results),
        startedAt,
        finishedAt: this.now().toISOString()
      };
      await this.history.update((history) => [report, ...history].slice(0, 50));
      job.status = report.cancelled ? "cancelled" : "completed";
      job.finishedAt = report.finishedAt;
      await persist(true);
      publishPatch({ phase: report.cancelled ? "cancelled" : "completed", cancellationPending: void 0 });
      return report;
    } catch (error) {
      job.status = "failed";
      job.finishedAt = this.now().toISOString();
      job.failureReason = operationReason(error);
      await persist(true);
      throw error;
    } finally {
      this.nonInterruptible = false;
      if (this.activeCleanup === abort) this.activeCleanup = void 0;
    }
  }
}

export {
  AggressiveController,
  operationReason,
  resultStatus
};
