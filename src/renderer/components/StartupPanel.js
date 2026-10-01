/**
 * components/StartupPanel.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * startup entries + restore.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { Clock3, RefreshCw, Rocket, RotateCcw, ShieldCheck, jsxRuntimeExports, reactExports } from "../vendor.js";
import { getJingJieApi } from "../lib/app-info.js";
function sourceLabel(source) {
  if (source === "registry") return "注册表启动";
  if (source === "startup-folder") return "启动文件夹";
  return "计划任务";
}
function StartupEffectSummary({ item }) {
  const effect = item.effect;
  if (!effect) return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: `startup-effect${effect.confidence === "low" ? " uncertain" : ""}`, children: [
    effect.confidence === "low" ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "startup-effect-warning", children: "影响尚不明确" }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "关闭后" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: effect.disabledEffect })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "仍可使用" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: effect.manualUse })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "建议" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: effect.recommendationReason })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("summary", { children: "判断依据" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: effect.evidence.join(" · ") })
    ] })
  ] });
}
function StartupPanel() {
  const [inventory, setInventory] = reactExports.useState();
  const [history, setHistory] = reactExports.useState([]);
  const [filter, setFilter] = reactExports.useState("enabled");
  const [selected, setSelected] = reactExports.useState(/* @__PURE__ */ new Set());
  const [loading, setLoading] = reactExports.useState(true);
  const [busy, setBusy] = reactExports.useState(false);
  const [report, setReport] = reactExports.useState();
  const [error, setError] = reactExports.useState();
  const load = async () => {
    setLoading(true);
    setError(void 0);
    try {
      const [items, records] = await Promise.all([getJingJieApi().listStartupItems(), getJingJieApi().getStartupHistory()]);
      setInventory(items);
      setHistory(records);
      setSelected(/* @__PURE__ */ new Set());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取启动项。");
    } finally {
      setLoading(false);
    }
  };
  reactExports.useEffect(() => {
    void load();
  }, []);
  const visible = reactExports.useMemo(() => (inventory?.items ?? []).filter((item) => filter === "protected" ? item.protected : !item.protected), [filter, inventory]);
  const restorable = history.filter((record) => record.status === "disabled" && record.backup);
  const toggle = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const disable = async () => {
    if (!inventory || selected.size === 0) return;
    setBusy(true);
    try {
      const result = await getJingJieApi().disableStartupItems(inventory.taskId, [...selected]);
      setReport(result);
      setSelected(/* @__PURE__ */ new Set());
      setHistory(await getJingJieApi().getStartupHistory());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "启动优化未完成。");
    } finally {
      setBusy(false);
    }
  };
  const restore = async (record) => {
    setBusy(true);
    try {
      await getJingJieApi().restoreStartupItem(record.id);
      setHistory(await getJingJieApi().getStartupHistory());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复失败，目标位置可能已有新项目。");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "software-console startup-console", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "software-heading", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-label", children: "Reversible startup control" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "开机更轻，改动可恢复" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "只管理用户可见的启动入口，不修改系统服务和驱动；不虚构“节省秒数”。" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-tally", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: inventory?.items.filter((item) => item.canDisable).length ?? "—" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: "可优化项目" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "startup-toolbar", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "segmented-control", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { "aria-pressed": filter === "enabled", onClick: () => setFilter("enabled"), children: "已启用" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { "aria-pressed": filter === "protected", onClick: () => setFilter("protected"), children: "受保护" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { "aria-pressed": filter === "history", onClick: () => setFilter("history"), children: "可恢复记录" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-command", "aria-label": "重新读取启动项", onClick: () => void load(), children: /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, {}) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "trust-note", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "可逆优先" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "禁用前保存原值、类型、路径与任务状态；恢复冲突时拒绝覆盖。" })
      ] })
    ] }),
    error ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "software-error", role: "alert", children: error }) : null,
    loading ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-loading", role: "status", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "loading-line" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "loading-line" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "正在读取启动入口…" })
    ] }) : null,
    !loading && filter !== "history" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "startup-list", children: [
      visible.map((item) => /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: `startup-row${item.protected ? " protected" : ""}`, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", "aria-label": `选择 ${item.name}`, checked: selected.has(item.id), onChange: () => toggle(item.id), disabled: !item.canDisable || busy }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "startup-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Rocket, {}) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "startup-copy", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: item.name }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("small", { children: [
            item.publisher ?? "发布者未知",
            " · ",
            sourceLabel(item.source)
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("code", { children: item.command }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(StartupEffectSummary, { item })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `impact impact-${item.impact}`, children: item.protected ? "受保护" : `${item.impact === "high" ? "高" : item.impact === "medium" ? "中" : "低"}影响` })
      ] }, item.id)),
      visible.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-empty", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Rocket, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "当前筛选没有项目" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "重新读取或切换筛选条件。" })
      ] }) : null
    ] }) : null,
    !loading && filter === "history" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "startup-list", children: [
      restorable.map((record) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "startup-row startup-history-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "startup-icon", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Clock3, {}) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "startup-copy", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: record.original.name }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("small", { children: [
            sourceLabel(record.original.source),
            " · 已安全禁用"
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary", "aria-label": `恢复 ${record.original.name}`, onClick: () => void restore(record), disabled: busy, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, {}),
          "恢复"
        ] })
      ] }, record.id)),
      restorable.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-empty", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "暂无可恢复记录" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "禁用启动项后会出现在这里。" })
      ] }) : null
    ] }) : null,
    report?.disabledCount ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", role: "status", children: [
      "已禁用 ",
      report.disabledCount,
      " 个启动项"
    ] }) : null,
    selected.size > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "uninstall-dock", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
            "已选择 ",
            selected.size,
            " 个启动项"
          ] }),
          "修改将写入可恢复记录"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "primary", onClick: () => void disable(), disabled: busy, children: busy ? "正在处理…" : `禁用 ${selected.size} 个启动项` })
    ] }) : null
  ] });
}
