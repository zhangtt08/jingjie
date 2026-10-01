/**
 * plan-controller.js -- NEW in the recovered repository: one reviewable maintenance plan.
 *
 * Why this exists (docs/PRODUCT-REVIEW.md):
 * the packaged 0.2.0-beta.6 shipped four separate flows, each with its own scan, its own
 * selection rules and its own result ledger. Deep cleanup had no per-item selection at all
 * (the renderer sent every id of the scan report), the aggressive scan told you only a size
 * per category -- never which files -- and nothing could re-run only what failed.
 *
 * This controller assembles the SAME four subsystems into one plan:
 *   build()   -> read-only inventory from the existing controllers (writes nothing)
 *   preview() -> the absolute paths and byte sizes a selection would touch, before executing
 *   execute() -> requires { confirm: true }; dispatches to the owning controller; per-item receipt
 *   retry()   -> re-sends only the items whose last receipt was failed
 *   history() -> bounded, crash-safe ledger of plan runs
 *
 * Nothing here deletes or uninstalls anything itself: every step goes through
 * CleanerController / AggressiveController / SoftwareController / StartupController, which
 * keep their own re-validation (path guards, size/mtime re-check, protection policy).
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AtomicJsonStore, SerialExecutor } from "./storage.js";

const MAX_HISTORY = 40;
const MAX_RECEIPTS_PER_SECTION = 400;
const MAX_PREVIEW_PATHS = 2000;
/** limits inherited from the existing controllers -- never exceed them here */
const BATCH_LIMITS = { cleanup: 5000, aggressive: 100, software: 100, startup: 100 };
/** skipping reasons that are policy decisions, not transient failures -> never auto-retried */
const POLICY_SKIPS = new Set(["startup-entry-protected", "standard-uninstall-not-allowed", "unknown-rule", "mode-mismatch"]);

function boundReceipts(items) {
  if (!Array.isArray(items) || items.length <= MAX_RECEIPTS_PER_SECTION) return items;
  const failures = items.filter((item) => item.status !== "succeeded");
  const kept = failures.slice(0, MAX_RECEIPTS_PER_SECTION);
  if (kept.length < MAX_RECEIPTS_PER_SECTION) {
    kept.push(...items.filter((item) => item.status === "succeeded").slice(0, MAX_RECEIPTS_PER_SECTION - kept.length));
  }
  return [...kept, { itemId: "-", status: "truncated", reason: "receipt-list-truncated", omittedCount: items.length - kept.length }];
}

export class PlanController {
  constructor(options) {
    if (!options?.dataRoot) throw new Error("plan-controller: dataRoot is required");
    this.cleaner = options.cleanerController;
    this.aggressive = options.aggressiveController;
    this.software = options.softwareController;
    this.startup = options.startupController;
    this.dataRoot = options.dataRoot;
    this.historyStore = new AtomicJsonStore(join(options.dataRoot, "plan-history.json"), []);
    this.serial = new SerialExecutor();
    this.plans = new Map();
    this.listeners = new Set();
    this.now = options.now ?? (() => new Date());
    this.planTtlMs = options.planTtlMs ?? 15 * 60 * 1000;
    this.lastRun = null;
  }

  onProgress(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(progress) {
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(progress));
      } catch { /* a broken listener must never stop an execution */ }
    }
  }

  /** Expired snapshots are dropped so an old plan can never run against a stale filesystem. */
  prune() {
    const now = this.now().getTime();
    for (const [id, plan] of this.plans) if (plan.expiresAt <= now) this.plans.delete(id);
  }

  /**
   * Read-only: ask every subsystem for its current inventory and merge into one plan.
   * Each section carries its own `status`, so a failing subsystem shows up as a real
   * failure instead of an empty list.
   */
  async build({ include } = {}) {
    this.prune();
    const wanted = { cleanup: true, aggressive: true, software: true, startup: true, ...include };
    const sections = [];

    if (wanted.cleanup) {
      sections.push(await this.#section("cleanup", "深度清理", async () => {
        const report = await this.cleaner.scan();
        return {
          sourceTaskId: report.taskId,
          totals: { bytes: report.totalBytes, itemCount: report.items.length },
          skippedCount: report.skipped.length,
          groups: groupBy(report.items, (item) => item.ruleId, (item) => item.category).map((group) => ({
            id: group.key,
            label: group.label,
            sizeBytes: group.rows.reduce((sum, item) => sum + item.sizeBytes, 0),
            itemCount: group.rows.length,
            action: group.rows[0].mode,
            reversible: group.rows[0].mode === "quarantine",
            privilege: group.key === "windows-temp" ? "administrator" : "user",
            items: group.rows.map((item) => ({
              id: item.id,
              label: item.relativePath,
              path: item.path,
              sizeBytes: item.sizeBytes,
              modifiedAt: item.modifiedAt,
              action: item.mode,
              reversible: item.mode === "quarantine",
              requiresAdministrator: group.key === "windows-temp",
              selectedByDefault: true
            }))
          }))
        };
      }));
    }

    if (wanted.aggressive) {
      sections.push(await this.#section("aggressive", "扩展清理", async () => {
        const report = await this.aggressive.scan();
        return {
          sourceTaskId: report.taskId,
          totals: { bytes: report.totalBytes, itemCount: report.totalItemCount },
          protectedSummary: report.protectedSummary,
          groups: report.categories
            .map((category) => ({
              id: category.id,
              label: category.label,
              sizeBytes: category.sizeBytes,
              itemCount: category.itemCount,
              status: category.status,
              message: category.message,
              candidates: report.candidates
                .filter((candidate) => candidate.categoryId === category.id)
                .map((candidate) => ({
                  id: candidate.id,
                  kind: candidate.kind,
                  label: candidate.label,
                  sizeBytes: candidate.sizeBytes,
                  itemCount: candidate.itemCount,
                  impact: candidate.impact,
                  preservationSummary: candidate.preservationSummary,
                  privilege: candidate.privilege,
                  reversible: candidate.kind === "file-cache",
                  irreversible: candidate.kind === "recycle-bin",
                  requiresAdministrator: candidate.privilege === "administrator",
                  // an irreversible action is never pre-selected (SECURITY-REVIEW S-03)
                  selectedByDefault: candidate.selectedByDefault === true && candidate.kind !== "recycle-bin"
                }))
            }))
            .filter((group) => group.candidates.length > 0 || group.status !== "empty")
        };
      }));
    }

    if (wanted.software) {
      sections.push(await this.#section("software", "软件卸载", async () => {
        const report = await this.software.inventory();
        return {
          sourceTaskId: report.taskId,
          totals: { bytes: report.items.reduce((sum, item) => sum + (item.estimatedSizeBytes ?? 0), 0), itemCount: report.items.length },
          groups: [{
            id: "installed",
            label: "已登记软件",
            itemCount: report.items.length,
            candidates: report.items.map((item) => ({
              id: item.id,
              label: item.name,
              detail: `${item.publisher ?? "发布者未知"} · ${item.version ?? "版本未知"}`,
              path: item.installLocation ?? null,
              sizeBytes: item.estimatedSizeBytes ?? 0,
              impact: item.risk,
              privilege: item.scope === "machine" ? "administrator" : "user",
              requiresAdministrator: item.scope === "machine",
              reversible: false,
              standardUninstallAllowed: item.standardUninstallAllowed,
              protectedReasons: item.protectedReasons,
              selectedByDefault: false
            }))
          }]
        };
      }));
    }

    if (wanted.startup) {
      sections.push(await this.#section("startup", "启动优化", async () => {
        const report = await this.startup.inventory();
        return {
          sourceTaskId: report.taskId,
          totals: { bytes: 0, itemCount: report.items.filter((item) => item.canDisable).length },
          groups: [{
            id: "startup-entries",
            label: "登录启动入口",
            itemCount: report.items.length,
            candidates: report.items.map((item) => ({
              id: item.id,
              label: item.name,
              detail: item.command,
              path: item.filePath ?? item.executablePath ?? item.registryKey ?? item.taskPath ?? null,
              sizeBytes: item.fileSize ?? 0,
              impact: item.impact,
              privilege: item.scope === "machine" ? "administrator" : "user",
              requiresAdministrator: item.scope === "machine",
              reversible: true,
              protected: item.protected,
              canDisable: item.canDisable,
              effectSummary: item.effect ? item.effect.disabledEffect : null,
              selectedByDefault: false
            }))
          }]
        };
      }));
    }

    const plan = {
      planId: randomUUID(),
      startedAt: this.now().toISOString(),
      expiresAt: this.now().getTime() + this.planTtlMs,
      // SECURITY-REVIEW S-01: ids handed back by preview(). Nothing destructive can run for an
      // id that was never shown to the caller -- "列出将影响的绝对路径" is a precondition now.
      previewed: new Set(),
      sections
    };
    this.plans.set(plan.planId, plan);
    return this.summarize(plan.planId);
  }

  async #section(id, label, produce) {
    try {
      return { id, label, status: "ready", ...(await produce()) };
    } catch (error) {
      return { id, label, status: "failed", reason: error instanceof Error ? error.message : "section-failed", groups: [] };
    }
  }

  get(planId) {
    this.prune();
    const plan = this.plans.get(planId);
    if (!plan) throw new Error("unknown-plan");
    return plan;
  }

  summarize(planId) {
    const plan = this.get(planId);
    return {
      planId: plan.planId,
      startedAt: plan.startedAt,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      sections: plan.sections.map((section) => {
        const groups = (section.groups ?? []).map((group) => {
          const entries = group.items ?? group.candidates ?? [];
          return {
            id: group.id,
            label: group.label,
            sizeBytes: group.sizeBytes ?? entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
            itemCount: group.itemCount ?? entries.length,
            status: group.status,
            message: group.message,
            reversible: group.reversible,
            action: group.action,
            privilege: group.privilege,
            entryCount: entries.length,
            defaultSelectedCount: entries.filter((entry) => entry.selectedByDefault).length,
            irreversibleCount: entries.filter((entry) => entry.irreversible).length,
            administratorCount: entries.filter((entry) => entry.requiresAdministrator || entry.privilege === "administrator").length
          };
        });
        return {
          id: section.id,
          label: section.label,
          status: section.status,
          reason: section.reason,
          totals: section.totals,
          protectedSummary: section.protectedSummary,
          skippedCount: section.skippedCount,
          groups
        };
      })
    };
  }

  entriesOf(planId, sectionId) {
    const plan = this.get(planId);
    const section = plan.sections.find((candidate) => candidate.id === sectionId);
    if (!section) throw new Error("unknown-plan-section");
    return (section.groups ?? []).flatMap((group) => (group.items ?? group.candidates ?? []).map((entry) => ({ ...entry, groupId: group.id })));
  }

  /**
   * Read-only dry run: expand a selection into the absolute paths and byte sizes it would
   * touch. Selection entries are ids, optionally prefixed with the section ("cleanup:<id>").
   */
  async preview(planId, selection) {
    const plan = this.get(planId);
    const wanted = normalizeSelection(selection);
    const sections = [];
    for (const section of plan.sections) {
      const chosen = [];
      for (const group of section.groups ?? []) {
        for (const item of group.items ?? group.candidates ?? []) {
          if (isSelected(wanted, section.id, item.id)) chosen.push(item);
        }
      }
      if (!chosen.length) continue;
      const paths = [];
      const flags = { irreversible: false, administrator: false, protected: false };
      let bytes = 0;
      for (const item of chosen) {
        plan.previewed.add(`${section.id}:${item.id}`);
        bytes += item.sizeBytes ?? 0;
        if (item.irreversible) flags.irreversible = true;
        if (item.requiresAdministrator || item.privilege === "administrator") flags.administrator = true;
        if (item.protected === true) flags.protected = true;
        if (item.path) {
          paths.push({ path: item.path, sizeBytes: item.sizeBytes ?? 0, action: item.action ?? null, label: item.label });
        } else if (section.id === "aggressive" && item.kind === "file-cache") {
          // the aggressive scan keeps the per-file list in its own snapshot; read it out (no walking)
          for (const file of this.aggressive.candidateFiles?.(item.id) ?? []) {
            paths.push({ path: file.path, sizeBytes: file.sizeBytes, action: "delete", label: item.label });
          }
        }
      }
      sections.push({
        id: section.id,
        label: section.label,
        itemCount: chosen.length,
        sizeBytes: bytes,
        flags,
        pathCount: paths.length,
        pathsShown: Math.min(paths.length, MAX_PREVIEW_PATHS),
        paths: paths.slice(0, MAX_PREVIEW_PATHS)
      });
    }
    return {
      planId,
      generatedAt: this.now().toISOString(),
      dryRun: true,
      totalSizeBytes: sections.reduce((sum, section) => sum + section.sizeBytes, 0),
      totalItemCount: sections.reduce((sum, section) => sum + section.itemCount, 0),
      needsAdministrator: sections.some((section) => section.flags.administrator),
      containsIrreversible: sections.some((section) => section.flags.irreversible),
      containsProtectedSelection: sections.some((section) => section.flags.protected),
      sections
    };
  }

  /**
   * Execute a previewed selection. `confirm: true` is mandatory -- the caller must have
   * received a preview first; destructive work must never start from a bare id list.
   */
  execute(planId, selection, { confirm = false, irreversibleAck = false, onProgress } = {}) {
    if (confirm !== true) throw new Error("confirmation-required");
    const wanted = normalizeSelection(selection);
    return this.serial.run(() => this.#executeExclusive(planId, wanted, { confirm, irreversibleAck, onProgress }));
  }

  async #executeExclusive(planId, wanted, { confirm, irreversibleAck, onProgress }) {
    const plan = this.get(planId);
    const runId = randomUUID();
    const startedAt = this.now().toISOString();
    const receipts = [];

    for (const section of plan.sections) {
      const chosen = [];
      for (const group of section.groups ?? []) {
        for (const item of group.items ?? group.candidates ?? []) {
          if (isSelected(wanted, section.id, item.id)) chosen.push(item);
        }
      }
      if (!chosen.length) continue;
      const notPreviewed = chosen.filter((item) => !plan.previewed.has(`${section.id}:${item.id}`));
      if (notPreviewed.length) {
        const receipt = { sectionId: section.id, label: section.label, items: notPreviewed.slice(0, 20).map((item) => ({ itemId: item.id, label: item.label, status: "refused", reason: "preview-required" })) };
        receipts.push(receipt);
        emit({ phase: "refused", reason: "preview-required", count: notPreviewed.length });
        continue;
      }
      const receipt = { sectionId: section.id, label: section.label, items: [] };
      receipts.push(receipt);
      const labelOf = new Map(chosen.map((item) => [item.id, item]));
      const emit = (patch) => {
        const progress = { runId, planId, sectionId: section.id, ...patch };
        this.publish(progress);
        try { onProgress?.(structuredClone(progress)); } catch { /* progress is best effort */ }
      };
      const limit = BATCH_LIMITS[section.id] ?? 100;
      const chunks = [];
      for (let index = 0; index < chosen.length; index += limit) chunks.push(chosen.slice(index, index + limit).map((item) => item.id));
      emit({ phase: "starting", itemCount: chosen.length, batches: chunks.length });

      try {
        for (const [index, itemIds] of chunks.entries()) {
          // the plan was confirmed by the caller; the owning controllers require the same flag,
          // so it is forwarded rather than bypassed -- and the irreversible acknowledgement only
          // reaches the aggressive controller when the caller actually gave it.
          const request = { taskId: section.sourceTaskId, itemIds, confirm: true };
          if (section.id === "aggressive" && irreversibleAck) request.irreversibleAck = true;
          emit({ phase: section.id === "software" ? "uninstalling" : section.id === "startup" ? "disabling" : "cleaning", batch: { index: index + 1, total: chunks.length } });
          let report;
          if (section.id === "cleanup") report = await this.cleaner.clean(request);
          else if (section.id === "aggressive") report = await this.aggressive.clean(request);
          else if (section.id === "software") report = await this.software.uninstall(request);
          else if (section.id === "startup") report = await this.startup.disable(request);
          else {
            receipt.items.push({ itemId: "-", label: section.label, status: "skipped", reason: "unknown-section" });
            break;
          }
          const idKey = section.id === "aggressive" ? "candidateId" : "itemId";
          for (const result of report.results) {
            const id = result[idKey];
            const item = labelOf.get(id);
            receipt.items.push({
              itemId: id,
              label: item?.label ?? String(id),
              path: item?.path ?? null,
              sizeBytes: section.id === "aggressive" ? result.freedBytes ?? 0 : item?.sizeBytes ?? 0,
              status: result.status === "disabled" ? "succeeded" : result.status,
              reason: result.reason ?? null,
              action: result.action ?? item?.action ?? null,
              processedCount: result.processedCount ?? null,
              transactionId: result.transactionId ?? null,
              restartRequired: result.restartRequired ?? false,
              exitCode: result.exitCode
            });
          }
          if (report.cancelled) {
            emit({ phase: "cancelled" });
            break;
          }
        }
      } catch (error) {
        receipt.items.push({
          itemId: "-",
          label: section.label,
          status: "failed",
          reason: error instanceof Error ? error.message : "section-failed"
        });
      }
      emit({ phase: "completed", succeededCount: receipt.items.filter((item) => item.status === "succeeded").length });
    }

    const finishedAt = this.now().toISOString();
    const flattened = receipts.flatMap((receipt) => receipt.items);
    const run = {
      runId,
      planId,
      startedAt,
      finishedAt,
      irreversibleAck: irreversibleAck === true,
      freedBytes: flattened.reduce((sum, item) => sum + (item.status === "succeeded" ? item.sizeBytes ?? 0 : 0), 0),
      counts: {
        succeeded: flattened.filter((item) => item.status === "succeeded").length,
        skipped: flattened.filter((item) => item.status === "skipped").length,
        failed: flattened.filter((item) => item.status === "failed").length,
        rebootRequired: flattened.filter((item) => item.status === "reboot-required").length
      },
      sections: receipts.map((receipt) => ({ ...receipt, items: boundReceipts(receipt.items) }))
    };
    await this.historyStore.update((history) => [run, ...history].slice(0, MAX_HISTORY));
    this.lastRun = run;
    return run;
  }

  /**
   * Re-run only what genuinely failed last time. Policy skips (protected entries) are not
   * retried -- retrying a deliberate refusal would just be a way to wear the guard down.
   */
  async retry({ onProgress } = {}) {
    if (!this.lastRun) throw new Error("no-run-to-retry");
    const selection = [];
    for (const receipt of this.lastRun.sections) {
      for (const item of receipt.items) {
        if (item.itemId === "-") continue;
        const transientFailure = item.status === "failed";
        const retryableSkip = item.status === "skipped" && !POLICY_SKIPS.has(item.reason);
        if (transientFailure || retryableSkip) selection.push(`${receipt.sectionId}:${item.itemId}`);
      }
    }
    if (!selection.length) return { retried: 0, run: this.lastRun };
    if (!this.plans.has(this.lastRun.planId)) throw new Error("expired-plan");
    const run = await this.execute(this.lastRun.planId, selection, {
      confirm: true,
      // an item that needed the irreversible acknowledgement keeps needing it on retry
      irreversibleAck: this.lastRun.irreversibleAck === true,
      onProgress
    });
    return { retried: selection.length, run };
  }

  history() {
    return this.historyStore.read();
  }
}

function normalizeSelection(selection) {
  if (!Array.isArray(selection) || selection.length === 0) throw new Error("invalid-plan-selection");
  const bare = new Set();
  const bySection = new Map();
  for (const value of selection) {
    if (typeof value !== "string" || value.length === 0 || value.length > 260) throw new Error("invalid-plan-selection");
    const separator = value.indexOf(":");
    if (separator > 0 && separator < value.length - 1) {
      const sectionId = value.slice(0, separator);
      if (!bySection.has(sectionId)) bySection.set(sectionId, new Set());
      bySection.get(sectionId).add(value.slice(separator + 1));
    } else {
      bare.add(value);
    }
  }
  const total = bare.size + [...bySection.values()].reduce((sum, set) => sum + set.size, 0);
  if (total === 0 || total > 20000) throw new Error("invalid-plan-selection");
  return { bare, bySection };
}

function isSelected(wanted, sectionId, itemId) {
  return wanted.bare.has(itemId) || wanted.bySection.get(sectionId)?.has(itemId) === true;
}

function groupBy(rows, keyOf, labelOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, { key, label: labelOf(row), rows: [] });
    map.get(key).rows.push(row);
  }
  return [...map.values()];
}
