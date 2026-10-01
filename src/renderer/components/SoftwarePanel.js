/**
 * components/SoftwarePanel.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * software ledger + uninstall flow.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { Boxes, CircleCheck, RefreshCw, Search, ShieldCheck, TriangleAlert, Undo2, UserRound, jsxRuntimeExports, reactExports } from "../vendor.js";
import { describeFailure, getJingJieApi } from "../lib/app-info.js";
import { formatBytes } from "../lib/format.js";
import { UNINSTALL_BATCH_SIZE, failureReason, mergeUninstallReports, riskLabel, sourceLabel$1 } from "../lib/software.js";
function SoftwarePanel() {
  const [inventory, setInventory] = reactExports.useState();
  const [loading, setLoading] = reactExports.useState(true);
  const [submitting, setSubmitting] = reactExports.useState(false);
  const [error, setError] = reactExports.useState();
  const [query, setQuery] = reactExports.useState("");
  const [filter, setFilter] = reactExports.useState("all");
  const [selected, setSelected] = reactExports.useState(/* @__PURE__ */ new Set());
  const [report, setReport] = reactExports.useState();
  const [progress, setProgress] = reactExports.useState();
  const [snapshotNames, setSnapshotNames] = reactExports.useState({});
  const [batch, setBatch] = reactExports.useState();
  const loadInventory = async () => {
    setLoading(true);
    setError(void 0);
    setReport(void 0);
    setProgress(void 0);
    setSelected(/* @__PURE__ */ new Set());
    try {
      setInventory(await getJingJieApi().listSoftware());
    } catch (reason) {
      setError(describeFailure(reason, "无法读取已安装软件，请重试。"));
    } finally {
      setLoading(false);
    }
  };
  const refreshInventory = async () => {
    try {
      setInventory(await getJingJieApi().listSoftware());
    } catch {
    }
  };
  reactExports.useEffect(() => {
    void loadInventory();
  }, []);
  reactExports.useEffect(() => {
    const unsubscribe = getJingJieApi().onSoftwareUninstallProgress((next) => setProgress(next));
    return unsubscribe;
  }, []);
  const visibleItems = reactExports.useMemo(() => {
    const search = query.trim().toLocaleLowerCase("zh-CN");
    return (inventory?.items ?? []).filter((item) => {
      if (filter === "uninstallable" && !item.standardUninstallAllowed) return false;
      if (filter === "protected" && item.risk !== "protected") return false;
      if (!search) return true;
      return `${item.name}
${item.publisher ?? ""}`.toLocaleLowerCase("zh-CN").includes(search);
    });
  }, [filter, inventory, query]);
  const selectableVisible = visibleItems.filter((item) => item.standardUninstallAllowed);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((item) => selected.has(item.id));
  const toggleItem = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of selectableVisible) {
        if (allVisibleSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  };
  const uninstall = async () => {
    if (!inventory || selected.size === 0) return;
    const names = {};
    for (const item of inventory.items) {
      if (selected.has(item.id)) names[item.id] = item.name;
    }
    setSnapshotNames(names);
    setSubmitting(true);
    setError(void 0);
    setProgress(void 0);
    const selectedIds = [...selected];
    const batches = [];
    for (let start = 0; start < selectedIds.length; start += UNINSTALL_BATCH_SIZE) {
      batches.push(selectedIds.slice(start, start + UNINSTALL_BATCH_SIZE));
    }
    let merged;
    try {
      for (let index = 0; index < batches.length; index += 1) {
        setBatch({ index: index + 1, total: batches.length });
        const result = await getJingJieApi().uninstallSoftware(inventory.taskId, batches[index]);
        merged = mergeUninstallReports(merged, result);
        setReport(merged);
      }
      setSelected(/* @__PURE__ */ new Set());
      await refreshInventory();
    } catch (reason) {
      setError(describeFailure(reason, "卸载任务未完成，请重新读取软件清单。"));
    } finally {
      setSubmitting(false);
      setBatch(void 0);
      setProgress(void 0);
    }
  };
  const percent = progress?.totalCount ? Math.min(100, Math.round(progress.processedCount / progress.totalCount * 100)) : 0;
  const failures = report ? report.results.filter((result) => result.status === "failed") : [];
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "software-console", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "software-heading", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-label", children: "Installed software ledger" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "卸载有依据，边界看得见" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "只调用系统登记的卸载方式。驱动、安全软件与系统组件保留保护边界。" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-tally", "aria-label": "软件统计", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: inventory?.items.length ?? "—" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: "已登记软件" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-commandbar", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "software-search", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Search, { "aria-hidden": "true" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "search",
            "aria-label": "搜索已安装软件",
            placeholder: "名称或发布者",
            value: query,
            onChange: (event) => setQuery(event.target.value)
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "segmented-control", "aria-label": "软件筛选", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { "aria-pressed": filter === "all", onClick: () => setFilter("all"), children: "全部" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { "aria-pressed": filter === "uninstallable", onClick: () => setFilter("uninstallable"), children: "可卸载" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { "aria-pressed": filter === "protected", onClick: () => setFilter("protected"), children: "受保护" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-command", "aria-label": "重新读取软件清单", onClick: () => void loadInventory(), disabled: loading || submitting, children: /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, {}) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "trust-note", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "执行边界" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "界面只提交本次清单中的 ID，不接收路径、命令或包名。" })
      ] })
    ] }),
    loading ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-loading", role: "status", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "loading-line" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "loading-line" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "loading-line" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "正在读取已安装软件…" })
    ] }) : null,
    error ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-error", role: "alert", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, {}),
      error
    ] }) : null,
    !loading && inventory ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-ledger", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ledger-head", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              type: "checkbox",
              "aria-label": "选择当前可卸载软件",
              checked: allVisibleSelected,
              onChange: toggleVisible,
              disabled: selectableVisible.length === 0
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "软件 / 发布者" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "来源" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "占用" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "策略" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ledger-body", children: [
        visibleItems.map((item) => /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: `software-row risk-${item.risk}${!item.standardUninstallAllowed ? " immutable" : ""}`, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "software-identity", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "checkbox",
                "aria-label": `选择 ${item.name}`,
                checked: selected.has(item.id),
                onChange: () => toggleItem(item.id),
                disabled: !item.standardUninstallAllowed || submitting
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "software-monogram", "aria-hidden": "true", children: item.name.slice(0, 1).toLocaleUpperCase("zh-CN") }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "software-copy", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: item.name }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("small", { children: [
                item.publisher ?? "发布者未知",
                " · ",
                item.version ?? "版本未知"
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ledger-meta", children: [
            item.scope === "machine" ? /* @__PURE__ */ jsxRuntimeExports.jsx(Boxes, {}) : /* @__PURE__ */ jsxRuntimeExports.jsx(UserRound, {}),
            sourceLabel$1(item)
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ledger-size", children: formatBytes(item.estimatedSizeBytes) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `policy-badge policy-${item.risk}`, children: riskLabel(item) })
        ] }, item.id)),
        visibleItems.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "software-empty", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Search, {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "没有匹配的软件" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "调整搜索词或筛选条件。" })
        ] }) : null
      ] })
    ] }) : null,
    submitting && progress ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "uninstall-progress", role: "status", "aria-live": "polite", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "uninstall-progress-head", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: progress.phase === "starting" ? "正在准备卸载计划" : progress.phase === "completed" ? "卸载已结束" : `正在卸载：${progress.currentName ?? "…"}` }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          batch ? `第 ${batch.index} / ${batch.total} 批 · ` : "",
          progress.processedCount,
          " / ",
          progress.totalCount
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "uninstall-progress-track", role: "progressbar", "aria-label": "卸载进度", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { width: `${percent}%` } }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "uninstall-progress-stats", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "成功 ",
          progress.succeededCount
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "失败 ",
          progress.failedCount
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "跳过 ",
          progress.skippedCount
        ] })
      ] })
    ] }) : null,
    report ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "uninstall-result", role: "status", children: [
      report.rebootRequiredCount > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Undo2, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
          report.rebootRequiredCount,
          " 个软件需要重启"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "保存工作后重启 Windows 即可完成。" })
      ] }) : null,
      report.skippedCount > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
          report.skippedCount,
          " 个项目已跳过"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "安全策略未允许执行，系统未做改动。" })
      ] }) : null,
      report.failedCount > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tone-danger", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
          report.failedCount,
          " 个软件未卸载成功"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "系统卸载器返回失败，原因见下方明细。" })
      ] }) : null,
      report.succeededCount > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CircleCheck, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
          report.succeededCount,
          " 个软件已卸载"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "卸载程序已正常结束。" })
      ] }) : null
    ] }) : null,
    failures.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "uninstall-failures", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { children: "未卸载成功的软件" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { children: failures.map((failure) => /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: snapshotNames[failure.itemId] ?? "未知软件" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: failureReason(failure.reason, failure.exitCode) })
      ] }, failure.itemId)) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "软件仍在系统中，可稍后重试；若卸载程序要求重启，请先重启再试。" })
    ] }) : null,
    selected.size > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "uninstall-dock", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
            "已选择 ",
            selected.size,
            " 个软件"
          ] }),
          "机器级软件可能触发一次 Windows UAC 确认"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "primary", onClick: () => void uninstall(), disabled: submitting, children: submitting ? "正在卸载…" : `卸载 ${selected.size} 个软件` })
    ] }) : null
  ] });
}
