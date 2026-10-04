/**
 * components/ScanPanel.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * deep cleanup scan/clean control.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { CircleStop, RotateCcw, ScanLine, ShieldCheck, jsxRuntimeExports } from "../vendor.js";
import { formatBytes$1 } from "../lib/format.js";
function actionLabel(phase, report) {
  if (phase === "idle") return "开始深度扫描";
  if (phase === "review") return `清理 ${report?.items.length ?? 0} 项`;
  if (phase === "completed") return "再次扫描";
  if (phase === "cancelled" || phase === "error") return "重新扫描";
  return "";
}
function ScanPanel({ phase, report, cleanup, progress, error, batch, onScan, onCancel, onClean, onCancelCleanup }) {
  const isBusy = phase === "scanning" || phase === "cleaning";
  const percent = progress?.totalCount ? Math.min(100, Math.round(progress.processedCount / progress.totalCount * 100)) : 0;
  const currentCategory = report?.categories.find((category) => category.ruleId === progress?.currentRuleId)?.label;
  const value = phase === "cleaning" && progress ? `${percent}%` : report ? formatBytes$1(report.totalBytes) : "—";
  const label = phase === "scanning" ? "正在检查允许的缓存目录" : phase === "cleaning" ? progress?.phase === "cancelling" ? "正在完成当前项目，随后停止" : "正在执行已验证的清理计划" : phase === "completed" ? `已释放 ${formatBytes$1(cleanup?.freedBytes ?? 0)}` : phase === "cancelled" && cleanup ? `已停止，已处理 ${cleanup.results.length} 项` : report ? "可安全处理" : "尚未扫描";
  const action = actionLabel(phase, report);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: `scan-panel ${isBusy ? "busy" : ""} phase-${phase}`, "aria-busy": isBusy, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "scan-panel-head", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "实时扫描 · 本地执行" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "drive-label", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
        " Windows 11"
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "scan-orbit", "aria-live": "polite", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "scan-value", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: value }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: label })
    ] }) }),
    phase === "cleaning" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "cleanup-progress", role: "status", "aria-live": "polite", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "cleanup-progress-head", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: progress?.phase === "cancelling" ? "正在停止" : currentCategory ?? "准备安全清理" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          batch ? `第 ${batch.index} / ${batch.total} 批 · ` : "",
          percent,
          "%"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "cleanup-progress-track", role: "progressbar", "aria-label": "清理进度", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { width: `${percent}%` } }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "cleanup-progress-stats", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          progress?.processedCount ?? 0,
          " / ",
          progress?.totalCount ?? report?.items.length ?? 0,
          " 项"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "已释放 ",
          formatBytes$1(progress?.freedBytes ?? 0)
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          progress?.failedCount ?? 0,
          " 项未清理"
        ] })
      ] })
    ] }) : null,
    error ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "inline-error", children: error }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "scan-actions", children: [
      phase === "scanning" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary dark", onClick: onCancel, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CircleStop, {}),
        "取消扫描"
      ] }) : null,
      phase === "cleaning" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary dark", onClick: onCancelCleanup, disabled: progress?.phase === "cancelling", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CircleStop, {}),
        progress?.phase === "cancelling" ? "正在停止…" : "停止清理"
      ] }) : null,
      action ? /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "primary", onClick: phase === "review" ? onClean : onScan, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ScanLine, {}),
        action
      ] }) : null,
      phase === "review" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary dark", onClick: onScan, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, {}),
        "重新扫描"
      ] }) : null
    ] })
  ] });
}

export { ScanPanel, actionLabel };
