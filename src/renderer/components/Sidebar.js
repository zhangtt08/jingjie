/**
 * components/Sidebar.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * primary navigation.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { ArchiveRestore, Gauge, Info, LayoutDashboard, Rocket, RotateCcwClock, ScanSearch, ShieldAlert, Trash2, jsxRuntimeExports } from "../vendor.js";
function Sidebar({ active, onSelect, onOpenAbout }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "sidebar", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "brand", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "brand-mark", "aria-hidden": "true" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "净界" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("nav", { "aria-label": "主导航", className: "nav-list", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: active === "overview" ? "active" : "", onClick: () => onSelect("overview"), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(LayoutDashboard, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "总览" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { "aria-label": "深度清理", className: active === "cleanup" ? "active" : "", onClick: () => onSelect("cleanup"), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ScanSearch, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "深度清理" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { "aria-label": "激进清理", className: active === "aggressive" ? "active aggressive-nav" : "aggressive-nav", onClick: () => onSelect("aggressive"), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldAlert, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "激进清理" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: "独立" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { "aria-label": "软件卸载", className: active === "software" ? "active" : "", onClick: () => onSelect("software"), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "软件卸载" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { "aria-label": "启动优化", className: active === "startup" ? "active" : "", onClick: () => onSelect("startup"), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Rocket, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "启动优化" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { "aria-label": "隔离区", className: active === "quarantine" ? "active" : "", onClick: () => onSelect("quarantine"), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ArchiveRestore, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "隔离区" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { "aria-label": "扫描历史", className: active === "history" ? "active" : "", onClick: () => onSelect("history"), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcwClock, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "扫描历史" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-footer", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Gauge, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "核心保护已启用" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "POLICY 01.4" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "settings-button", "aria-label": "关于净界", onClick: onOpenAbout, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Info, {}) })
  ] });
}
