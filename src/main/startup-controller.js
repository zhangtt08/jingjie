/**
 * startup-controller.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * startup job ledger (planned/started/disabled/failed/restored).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { randomUUID, createHash } from "node:crypto";
import { AtomicJsonStore, SerialExecutor } from "./storage.js";
import { assertConfirmed } from "./request-validators.js";
import { isRetryableResult } from "./retry-policy.js";
class StartupController {
  constructor(options) {
    this.options = options;
    this.records = new AtomicJsonStore(options.historyPath, []);
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.ready = this.records.update((records) => records.map((record) => record.status === "started" ? { ...record, status: "interrupted", finishedAt: this.now().toISOString(), reason: "application-restarted" } : record));
  }
  options;
  records;
  serial = new SerialExecutor();
  snapshots = /* @__PURE__ */ new Map();
  now;
  ready;
  async inventory() {
    await this.ready;
    const started = this.now();
    const expires = new Date(started.getTime() + 15 * 6e4);
    const report = {
      taskId: randomUUID(),
      items: await this.options.provider.list(),
      startedAt: started.toISOString(),
      expiresAt: expires.toISOString()
    };
    this.snapshots.set(report.taskId, {
      report,
      remaining: new Set(report.items.map((item) => item.id)),
      expiresAt: expires.getTime()
    });
    return report;
  }
  disable(request) {
    // SECURITY-REVIEW S-02: disabling a startup entry writes to the registry / renames a file /
    // disables a scheduled task. Reversible, but still needs an explicit confirmation.
    assertConfirmed(request, "confirmation-required");
    return this.serial.run(() => this.disableExclusive(request));
  }
  async updateRecord(id, mutator) {
    await this.records.update((records) => records.map((record) => record.id === id ? mutator(record) : record));
  }
  async disableExclusive(request) {
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
    // 失败的启动项要留在快照里可重试；结果明朗后再处置（releaseSnapshot）。
    const startedAt = this.now().toISOString();
    const planned = selected.map((item) => ({
      id: randomUUID(),
      inventoryTaskId: request.taskId,
      itemId: item.id,
      original: structuredClone(item),
      status: "planned",
      startedAt
    }));
    await this.records.update((records) => [...planned, ...records].slice(0, 200));
    const results = [];
    for (const transaction of planned) {
      if (transaction.original.protected || !transaction.original.canDisable) {
        const result = { itemId: transaction.itemId, transactionId: transaction.id, status: "skipped", reason: "startup-entry-protected" };
        results.push(result);
        await this.updateRecord(transaction.id, (record) => ({ ...record, status: "skipped", finishedAt: this.now().toISOString(), reason: result.reason }));
        continue;
      }
      await this.updateRecord(transaction.id, (record) => ({ ...record, status: "started" }));
      try {
        const backup = await this.options.actions.disable(transaction.original, randomUUID());
        results.push({ itemId: transaction.itemId, transactionId: transaction.id, status: "disabled" });
        await this.updateRecord(transaction.id, (record) => ({ ...record, status: "disabled", backup, finishedAt: this.now().toISOString() }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "startup-action-failed";
        results.push({ itemId: transaction.itemId, transactionId: transaction.id, status: "failed", reason });
        await this.updateRecord(transaction.id, (record) => ({ ...record, status: "failed", finishedAt: this.now().toISOString(), reason }));
      }
    }
    this.releaseSnapshot(request.taskId, snapshot, request.itemIds, results);
    return {
      taskId: randomUUID(),
      requestedCount: selected.length,
      disabledCount: results.filter((result) => result.status === "disabled").length,
      failedCount: results.filter((result) => result.status === "failed").length,
      skippedCount: results.filter((result) => result.status === "skipped").length,
      results,
      startedAt,
      finishedAt: this.now().toISOString()
    };
  }
  /** Failed (e.g. UAC cancelled) entries stay claimable within the snapshot TTL; the rest are consumed. */
  releaseSnapshot(taskId, snapshot, requestedIds, results) {
    const byId = new Map((results ?? []).map((result) => [result.itemId, result]));
    for (const id of requestedIds) {
      const result = byId.get(id);
      if (!result || isRetryableResult(result)) snapshot.remaining.add(id);
    }
    if (snapshot.remaining.size === 0) this.snapshots.delete(taskId);
    else snapshot.expiresAt = this.now().getTime() + 15 * 6e4;
  }
  restore(id) {
    return this.serial.run(async () => {
      await this.ready;
      const record = (await this.records.read()).find((candidate) => candidate.id === id);
      if (!record) throw new Error("unknown-startup-record");
      if (record.status !== "disabled" || !record.backup) throw new Error("startup-record-not-disabled");
      const restored = await this.options.actions.restore(record.backup);
      const finishedAt = this.now().toISOString();
      await this.updateRecord(id, (current) => ({ ...current, status: "restored", backup: restored, finishedAt }));
      return { ...record, status: "restored", backup: restored, finishedAt };
    });
  }
  async history() {
    await this.ready;
    return this.records.read();
  }
}

export {
  StartupController
};
