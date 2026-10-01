/**
 * maintenance.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * Windows official maintenance actions (delivery optimization / DISM), one action per elevated call.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { execFile, spawn } from "node:child_process";
const ALLOWED_ACTIONS = /* @__PURE__ */ new Set(["delivery-optimization", "component-cleanup"]);
const ACTION_COPY = {
  "delivery-optimization": {
    label: "传递优化缓存",
    impact: "Windows 更新内容之后可能重新下载",
    preservationSummary: "保留 Windows 更新、回退能力和固定缓存内容"
  },
  "component-cleanup": {
    label: "Windows 组件维护",
    impact: "清理已被新版本取代的组件",
    preservationSummary: "保留 Windows 更新卸载、恢复环境和系统还原能力"
  }
};
function isActionId(value) {
  return typeof value === "string" && ALLOWED_ACTIONS.has(value);
}
function validCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value;
  return isActionId(item.actionId) && typeof item.label === "string" && typeof item.supported === "boolean" && Number.isSafeInteger(item.sizeBytes) && Number(item.sizeBytes) >= 0 && typeof item.sizeIsEstimate === "boolean" && typeof item.impact === "string" && typeof item.preservationSummary === "string" && (item.unavailableReason === void 0 || typeof item.unavailableReason === "string");
}
function validResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value;
  return isActionId(item.actionId) && (item.status === "succeeded" || item.status === "skipped" || item.status === "failed") && typeof item.restartRequired === "boolean" && (item.reason === void 0 || typeof item.reason === "string");
}
class MaintenanceProvider {
  constructor(probeRunner, actionRunner) {
    this.probeRunner = probeRunner;
    this.actionRunner = actionRunner;
  }
  probeRunner;
  actionRunner;
  async probe() {
    const raw = await this.probeRunner.runScript("aggressive-maintenance", { operation: "probe" });
    if (!Array.isArray(raw)) throw new Error("invalid-maintenance-probe");
    const seen = /* @__PURE__ */ new Set();
    return raw.filter(validCandidate).filter((candidate) => {
      if (seen.has(candidate.actionId)) return false;
      seen.add(candidate.actionId);
      return true;
    }).map((candidate) => ({ ...candidate, ...ACTION_COPY[candidate.actionId] }));
  }
  async execute(actionIds) {
    if (!Array.isArray(actionIds) || actionIds.length !== 1 || actionIds.some((actionId) => !isActionId(actionId)) || new Set(actionIds).size !== actionIds.length) {
      throw new Error("maintenance-action-not-allowed");
    }
    const outcome = await this.actionRunner.runActions([...actionIds]);
    if (!outcome.ok) {
      const reason = outcome.reason === "uac-cancelled" ? "permission-denied" : outcome.reason ?? "maintenance-provider-failed";
      return actionIds.map((actionId) => ({ actionId, status: "skipped", reason, restartRequired: false }));
    }
    if (!Array.isArray(outcome.results) || outcome.results.length !== actionIds.length || !outcome.results.every(validResult)) {
      throw new Error("invalid-maintenance-result");
    }
    const byId = new Map(outcome.results.map((result) => [result.actionId, result]));
    if (byId.size !== actionIds.length || actionIds.some((actionId) => !byId.has(actionId))) throw new Error("invalid-maintenance-result");
    return actionIds.map((actionId) => structuredClone(byId.get(actionId)));
  }
}
class NativeElevatedMaintenanceRunner {
  constructor(helperPath) {
    this.helperPath = helperPath;
  }
  helperPath;
  runActions(actionIds) {
    if (!Array.isArray(actionIds) || actionIds.length !== 1 || actionIds.some((actionId2) => !isActionId(actionId2)) || new Set(actionIds).size !== actionIds.length) {
      return Promise.resolve({ ok: false, reason: "maintenance-action-not-allowed" });
    }
    const actionId = actionIds[0];
    return new Promise((resolve2) => {
      execFile(this.helperPath, [
        "run-maintenance-action-elevated",
        actionId,
        "1800000"
      ], {
        windowsHide: true,
        shell: false,
        timeout: 183e4,
        maxBuffer: 64 * 1024,
        encoding: "utf8"
      }, (error, stdout) => {
        const output = stdout.trim();
        if (output === "uac-cancelled") return resolve2({ ok: false, reason: "uac-cancelled" });
        if (output === "timeout" || error?.killed) return resolve2({ ok: false, reason: "timeout" });
        const completed = /^completed:(-?\d+)$/.exec(output);
        if (!completed) return resolve2({ ok: false, reason: output || "elevation-helper-failed" });
        const exitCode = Number(completed[1]);
        const succeeded = exitCode === 0 || exitCode === 3010;
        resolve2({ ok: true, results: [{
          actionId,
          status: succeeded ? "succeeded" : "failed",
          reason: succeeded ? void 0 : `exit-code-${exitCode}`,
          restartRequired: exitCode === 3010
        }] });
      });
    });
  }
}

export {
  MaintenanceProvider,
  NativeElevatedMaintenanceRunner,
  ALLOWED_ACTIONS,
  ACTION_COPY,
  isActionId
};
