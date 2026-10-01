/**
 * components/HistoryPanel.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * history list.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { RotateCcwClock, jsxRuntimeExports } from "../vendor.js";
import { formatBytes$1 } from "../lib/format.js";
function HistoryPanel({ entries }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "content-panel", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "page-heading", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-label", children: "Local audit log" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "扫描历史" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "这里只记录本机任务结果，不上传文件路径。" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcwClock, {})
    ] }),
    entries.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcwClock, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: "还没有清理记录" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "完成第一次清理后，结果会显示在这里。" })
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "data-list", children: entries.map((entry) => /* @__PURE__ */ jsxRuntimeExports.jsxs("article", { className: "data-row history-row", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: new Date(entry.startedAt).toLocaleString("zh-CN") }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("small", { children: [
          "成功 ",
          entry.succeededCount,
          " · 未处理 ",
          entry.failedCount
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "data-size", children: formatBytes$1(entry.freedBytes) })
    ] }, entry.taskId)) })
  ] });
}
