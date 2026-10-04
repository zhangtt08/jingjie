/**
 * components/ResultsPanel.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * cleanup result banner.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { CircleAlert, CircleCheck, jsxRuntimeExports } from "../vendor.js";
import { formatBytes$1 } from "../lib/format.js";
function ResultsPanel({ report }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "result-banner", "aria-live": "polite", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "result-icon", children: report.failedCount ? /* @__PURE__ */ jsxRuntimeExports.jsx(CircleAlert, {}) : /* @__PURE__ */ jsxRuntimeExports.jsx(CircleCheck, {}) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
        "已处理 ",
        report.succeededCount,
        " 项"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
        "永久释放 ",
        formatBytes$1(report.freedBytes),
        report.quarantinedBytes ? `，隔离 ${formatBytes$1(report.quarantinedBytes)}` : "",
        "。",
        report.failedCount ? `${report.failedCount} 项未处理，可在历史中查看原因。` : "所有动作均已记录。"
      ] })
    ] })
  ] });
}

export { ResultsPanel };
