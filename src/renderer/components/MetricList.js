/**
 * components/MetricList.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * detected categories per rule.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { Database, FileExclamationPoint, ShieldCheck, jsxRuntimeExports } from "../vendor.js";
import { formatBytes$1 } from "../lib/format.js";
const fallback = [
  { ruleId: "user-temp", label: "用户临时文件", mode: "delete", itemCount: 0, sizeBytes: 0, skippedCount: 0 },
  { ruleId: "browser", label: "浏览器缓存", mode: "delete", itemCount: 0, sizeBytes: 0, skippedCount: 0 },
  { ruleId: "crash", label: "崩溃与诊断文件", mode: "delete", itemCount: 0, sizeBytes: 0, skippedCount: 0 }
];
function MetricList({ categories }) {
  const visible = categories?.length ? categories : fallback;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "metric-panel", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "section-label", children: "检测范围" }),
    visible.map((category, index) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "metric-row", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `metric-icon tone-${index % 3}`, children: index === 2 ? /* @__PURE__ */ jsxRuntimeExports.jsx(FileExclamationPoint, {}) : /* @__PURE__ */ jsxRuntimeExports.jsx(Database, {}) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "metric-copy", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: category.label }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("small", { children: [
          category.itemCount ? `${category.itemCount} 个项目` : "等待扫描",
          category.skippedCount ? ` · 跳过 ${category.skippedCount}` : ""
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "metric-value", children: formatBytes$1(category.sizeBytes) })
    ] }, category.ruleId)),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "protected-strip", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "硬性保护" }),
        "个人文件、驱动仓库和 Windows 核心始终排除。"
      ] })
    ] })
  ] });
}

export { MetricList, fallback };
