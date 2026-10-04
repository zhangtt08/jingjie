/**
 * software-controller.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * uninstall job runner with persisted per-item plan/results.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { randomUUID, createHash } from "node:crypto";
import { AtomicJsonStore, SerialExecutor } from "./storage.js";
import { assertConfirmed } from "./request-validators.js";
import { isRetryableResult } from "./retry-policy.js";
import { createUninstallAction } from "./uninstall-plan.js";
class SoftwareController {
  constructor(options) {
    this.options = options;
    this.reports = new AtomicJsonStore(options.historyPath, []);
    this.jobs = new AtomicJsonStore(`${options.historyPath}.jobs`, []);
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.ready = this.jobs.update((jobs) => jobs.map((job) => job.status === "in-progress" ? {
      ...job,
      status: "interrupted",
      finishedAt: this.now().toISOString(),
      failureReason: "application-restarted",
      plan: job.plan.map((item) => item.state === "started" ? { ...item, state: "interrupted" } : item)
    } : job));
  }
  options;
  reports;
  jobs;
  destructive = new SerialExecutor();
  snapshots = /* @__PURE__ */ new Map();
  progressListeners = /* @__PURE__ */ new Set();
  now;
  ready;
  lastProgress;
  async inventory() {
    await this.ready;
    const startedAt = this.now();
    const expiresAt = new Date(startedAt.getTime() + 15 * 6e4);
    const report = {
      taskId: randomUUID(),
      items: await this.options.provider.list(),
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
    this.snapshots.set(report.taskId, {
      report,
      remaining: new Set(report.items.map((item) => item.id)),
      expiresAt: expiresAt.getTime()
    });
    return report;
  }
  uninstall(request) {
    // SECURITY-REVIEW S-02: uninstalling is destructive; the request must be confirmed.
    assertConfirmed(request, "confirmation-required");
    return this.destructive.run(() => this.uninstallExclusive(request));
  }
  getProgress() {
    return this.lastProgress ? structuredClone(this.lastProgress) : void 0;
  }
  onProgress(listener) {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }
  publishProgress(progress) {
    this.lastProgress = structuredClone(progress);
    for (const listener of this.progressListeners) {
      try {
        listener(structuredClone(progress));
      } catch {
      }
    }
  }
  async updateJob(jobId, mutator) {
    await this.jobs.update((jobs) => jobs.map((job) => job.id === jobId ? mutator(job) : job));
  }
  async recordResult(jobId, result) {
    await this.updateJob(jobId, (job) => ({
      ...job,
      results: [...job.results, result],
      plan: job.plan.map((item) => item.itemId === result.itemId ? { ...item, state: result.status, result } : item)
    }));
  }
  async uninstallExclusive(request) {
    await this.ready;
    const snapshot = this.snapshots.get(request.taskId);
    if (!snapshot) throw new Error("unknown-task");
    if (snapshot.expiresAt <= this.now().getTime()) {
      this.snapshots.delete(request.taskId);
      throw new Error("expired-task");
    }
    const byId = new Map(snapshot.report.items.map((item) => [item.id, item]));
    const selected = request.itemIds.map((itemId2) => {
      const item = byId.get(itemId2);
      if (!item || !snapshot.remaining.has(itemId2)) throw new Error("unknown-item");
      return item;
    });
    for (const itemId2 of request.itemIds) snapshot.remaining.delete(itemId2);
    // 快照留到结果明朗再处置：失败的卸载要能重试（releaseSnapshot / retry-policy.js）。
    const jobId = randomUUID();
    const startedAt = this.now().toISOString();
    const job = {
      id: jobId,
      inventoryTaskId: request.taskId,
      status: "in-progress",
      plan: selected.map((item) => ({
        itemId: item.id,
        name: item.name,
        action: createUninstallAction(item),
        state: "planned"
      })),
      results: [],
      startedAt
    };
    await this.jobs.update((jobs) => [job, ...jobs].slice(0, 50));
    const collected = [];
    const emit = (phase, currentName) => this.publishProgress({
      jobId,
      phase,
      processedCount: collected.length,
      totalCount: job.plan.length,
      currentName,
      succeededCount: collected.filter((result) => result.status === "succeeded").length,
      failedCount: collected.filter((result) => result.status === "failed").length,
      skippedCount: collected.filter((result) => result.status === "skipped").length,
      rebootRequiredCount: collected.filter((result) => result.status === "reboot-required").length
    });
    emit("starting");
    try {
      for (const planned of job.plan) {
        if (planned.action.kind === "skip") {
          const skipped = {
            itemId: planned.itemId,
            status: "skipped",
            reason: planned.action.reason
          };
          await this.recordResult(jobId, skipped);
          collected.push(skipped);
          emit("uninstalling", planned.name);
          continue;
        }
        emit("uninstalling", planned.name);
        await this.updateJob(jobId, (current) => ({
          ...current,
          plan: current.plan.map((item) => item.itemId === planned.itemId ? { ...item, state: "started" } : item)
        }));
        let outcome;
        try {
          outcome = await this.options.executor.execute(planned.action);
        } catch (error) {
          outcome = {
            status: "failed",
            reason: error instanceof Error ? error.message : "executor-failed"
          };
        }
        const result = { itemId: planned.itemId, ...outcome };
        await this.recordResult(jobId, result);
        collected.push(result);
        emit("uninstalling");
      }
      const completedJob = (await this.jobs.read()).find((candidate) => candidate.id === jobId);
      const finishedAt = this.now().toISOString();
      const report = {
        taskId: jobId,
        requestedCount: selected.length,
        succeededCount: completedJob.results.filter((result) => result.status === "succeeded").length,
        rebootRequiredCount: completedJob.results.filter((result) => result.status === "reboot-required").length,
        failedCount: completedJob.results.filter((result) => result.status === "failed").length,
        skippedCount: completedJob.results.filter((result) => result.status === "skipped").length,
        results: completedJob.results,
        startedAt,
        finishedAt
      };
      this.releaseSnapshot(request.taskId, snapshot, request.itemIds, collected);
      await this.reports.update((reports) => [report, ...reports].slice(0, 50));
      await this.updateJob(jobId, (current) => ({ ...current, status: "completed", finishedAt }));
      emit("completed");
      return report;
    } catch (error) {
      this.releaseSnapshot(request.taskId, snapshot, request.itemIds, collected);
      await this.updateJob(jobId, (current) => ({
        ...current,
        status: "failed",
        finishedAt: this.now().toISOString(),
        failureReason: error instanceof Error ? error.message : "unknown-error"
      }));
      throw error;
    }
  }
  /**
   * Same contract as CleanerController.releaseSnapshot: only retryable outcomes (failed, or a
   * cancellation that never ran) stay claimable; succeeded / policy-skipped ids are consumed.
   */
  releaseSnapshot(taskId, snapshot, requestedIds, results) {
    const byId = new Map((results ?? []).map((result) => [result.itemId, result]));
    for (const id of requestedIds) {
      const result = byId.get(id);
      if (!result || isRetryableResult(result)) snapshot.remaining.add(id);
    }
    if (snapshot.remaining.size === 0) this.snapshots.delete(taskId);
    else snapshot.expiresAt = this.now().getTime() + 15 * 6e4;
  }
  async history() {
    await this.ready;
    return this.jobs.read();
  }
}

export {
  SoftwareController
};
