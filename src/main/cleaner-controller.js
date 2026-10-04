/**
 * cleaner-controller.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * deep cleanup controller: snapshot(15min) -> clean -> history.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AtomicJsonStore, SerialExecutor } from "./storage.js";
import { scanRules, executeCleanup } from "./cleanup-engine.js";
import { validateCleanRequest, assertConfirmed } from "./request-validators.js";
import { isRetryableResult } from "./retry-policy.js";
class CleanerController {
  constructor(options) {
    this.options = options;
    this.history = new AtomicJsonStore(options.historyPath, []);
    this.jobs = new AtomicJsonStore(`${options.historyPath}.jobs`, []);
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.ready = this.jobs.update((jobs) => jobs.map((job) => job.status === "in-progress" ? { ...job, status: "interrupted", finishedAt: this.now().toISOString(), failureReason: "application-restarted" } : job));
  }
  options;
  history;
  jobs;
  now;
  destructive = new SerialExecutor();
  ready;
  snapshots = /* @__PURE__ */ new Map();
  progressListeners = /* @__PURE__ */ new Set();
  activeScan;
  activeCleanup;
  cleanupProgress;
  async scan() {
    await this.ready;
    if (this.activeScan) throw new Error("scan-in-progress");
    const controller = new AbortController();
    this.activeScan = controller;
    try {
      const report = await scanRules(this.options.rules, {
        env: this.options.env,
        now: this.now(),
        signal: controller.signal
      });
      if (!report.cancelled) {
        this.snapshots.set(report.taskId, {
          report,
          remaining: new Set(report.items.map((item) => item.id)),
          expiresAt: this.now().getTime() + 15 * 60 * 1e3
        });
      }
      return report;
    } finally {
      this.activeScan = void 0;
    }
  }
  cancelScan() {
    if (!this.activeScan) return false;
    this.activeScan.abort();
    return true;
  }
  clean(input) {
    const request = validateCleanRequest(input);
    // SECURITY-REVIEW S-02: a delete request is only honoured with an explicit confirmation.
    assertConfirmed(request, "confirmation-required");
    return this.destructive.run(() => this.cleanExclusive(request));
  }
  cancelCleanup() {
    if (!this.activeCleanup || this.activeCleanup.signal.aborted) return false;
    this.activeCleanup.abort();
    if (this.cleanupProgress) this.publishProgress({ ...this.cleanupProgress, phase: "cancelling" });
    return true;
  }
  getCleanupProgress() {
    return this.cleanupProgress ? structuredClone(this.cleanupProgress) : void 0;
  }
  onProgress(listener) {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }
  publishProgress(progress) {
    this.cleanupProgress = structuredClone(progress);
    for (const listener of this.progressListeners) {
      try {
        listener(structuredClone(progress));
      } catch {
      }
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
    const byId = new Map(snapshot.report.items.map((item) => [item.id, item]));
    const selected = request.itemIds.map((id) => {
      const item = byId.get(id);
      if (!item || !snapshot.remaining.has(id)) throw new Error("unknown-item");
      return item;
    });
    for (const id of request.itemIds) snapshot.remaining.delete(id);
    // 快照先不删：失败/未处理的条目要留在 remaining 里才能重试（PRODUCT-REVIEW #3）。
    const jobId = randomUUID();
    const startedAt = this.now().toISOString();
    const job = {
      id: jobId,
      scanTaskId: request.taskId,
      status: "in-progress",
      itemIds: request.itemIds,
      plan: selected.map((item) => ({
        itemId: item.id,
        ruleId: item.ruleId,
        path: item.path,
        action: item.mode,
        sizeBytes: item.sizeBytes,
        modifiedAt: item.modifiedAt,
        state: "planned"
      })),
      results: [],
      startedAt
    };
    await this.jobs.update((jobs) => [job, ...jobs].slice(0, 50));
    const abortController = new AbortController();
    this.activeCleanup = abortController;
    const planById = new Map(job.plan.map((planned) => [planned.itemId, planned]));
    let resultsSinceCheckpoint = 0;
    let lastCheckpointAt = Date.now();
    const persistJob = async (force = false) => {
      const checkpointDue = resultsSinceCheckpoint >= 50 || Date.now() - lastCheckpointAt >= 1e3;
      if (!force && !checkpointDue) return;
      resultsSinceCheckpoint = 0;
      lastCheckpointAt = Date.now();
      await this.jobs.update((jobs) => jobs.map((candidate) => candidate.id === jobId ? structuredClone(job) : candidate));
    };
    const applyResult = (result) => {
      job.results.push(result);
      const planned = planById.get(result.itemId);
      if (planned) planned.state = result.status;
      resultsSinceCheckpoint += 1;
    };
    try {
      const report = await executeCleanup(selected, {
        env: this.options.env,
        rules: this.options.rules,
        quarantine: this.options.quarantine,
        fileOperations: this.options.fileOperations,
        now: this.now(),
        taskId: jobId,
        scanTaskId: request.taskId,
        signal: abortController.signal,
        onItemStart: (item) => {
          const planned = planById.get(item.id);
          if (planned) planned.state = "started";
        },
        onResult: async (result) => {
          applyResult(result);
          await persistJob();
        },
        onProgress: (progress) => {
          this.publishProgress(abortController.signal.aborted && progress.phase === "deleting" ? { ...progress, phase: "cancelling" } : progress);
        }
      });
      await this.history.update((history) => [report, ...history].slice(0, 50));
      this.releaseSnapshot(request.taskId, snapshot, request.itemIds, report.results);
      job.status = report.cancelled ? "cancelled" : "completed";
      job.results = report.results;
      job.finishedAt = report.finishedAt;
      await persistJob(true);
      return report;
    } catch (error) {
      // 整段失败：这一批 id 全部回到 remaining，快照还在 TTL 内就能重试（不谎报、不留半成品）。
      this.releaseSnapshot(request.taskId, snapshot, request.itemIds, []);
      job.status = "failed";
      job.finishedAt = this.now().toISOString();
      job.failureReason = error instanceof Error ? error.message : "unknown-error";
      await persistJob(true);
      throw error;
    } finally {
      if (this.activeCleanup === abortController) this.activeCleanup = void 0;
    }
  }
  /**
   * Only genuinely retryable outcomes stay claimable against this snapshot (retry-policy.js):
   * failed or items a cancellation never reached. Policy refusals and stale ids are consumed --
   * their honest remedy is a fresh scan, not a retry that can only skip again.
   */
  releaseSnapshot(taskId, snapshot, requestedIds, results) {
    const byId = new Map((results ?? []).map((result) => [result.itemId, result]));
    for (const id of requestedIds) {
      const result = byId.get(id);
      if (!result || isRetryableResult(result)) snapshot.remaining.add(id);
    }
    if (snapshot.remaining.size === 0) this.snapshots.delete(taskId);
    else snapshot.expiresAt = this.now().getTime() + 15 * 60 * 1e3;
  }
  getHistory() {
    return this.history.read();
  }
  listQuarantine() {
    return this.options.quarantine.list();
  }
  restoreQuarantine(id) {
    return this.destructive.run(() => this.options.quarantine.restore(id));
  }
}

export {
  CleanerController
};
