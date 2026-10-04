/**
 * components/QuarantinePanel.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * quarantine list + restore.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { ArchiveRestore, FileClock, RotateCcw, X, jsxRuntimeExports } from "../vendor.js";
import { formatBytes$1 } from "../lib/format.js";
function fileName(path) {
  return path.split(/[\\/]/).pop() ?? path;
}
function QuarantinePanel({ entries, loading, message, onRestore, onDismissMessage }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "content-panel", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "page-heading", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-label", children: "Recovery store" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "隔离区" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "受支持的残留保留 7 天。恢复时不会覆盖已有文件。" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(ArchiveRestore, {})
    ] }),
    message ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice notice-dismissible", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: message }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "notice-close", "aria-label": "关闭提示", onClick: onDismissMessage, children: /* @__PURE__ */ jsxRuntimeExports.jsx(X, {}) })
    ] }) : null,
    loading ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(FileClock, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "正在读取隔离索引…" })
    ] }) : null,
    !loading && entries.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-state", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(ArchiveRestore, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: "隔离区为空" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "当前没有待恢复项目。" })
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "data-list", children: entries.map((entry) => /* @__PURE__ */ jsxRuntimeExports.jsxs("article", { className: "data-row", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: fileName(entry.originalPath) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: entry.originalPath })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "data-size", children: formatBytes$1(entry.sizeBytes) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "data-expiry", children: [
        new Date(entry.expiresAt).toLocaleDateString("zh-CN"),
        " 到期"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary", onClick: () => onRestore(entry.id), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, {}),
        "恢复"
      ] })
    ] }, entry.id)) })
  ] });
}

export { QuarantinePanel, fileName };
