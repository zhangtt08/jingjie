/**
 * components/AggressivePanel.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * aggressive cleanup.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { Check, CircleStop, Cloud, Database, FolderLock, Gauge, HardDrive, PackageCheck, RotateCcw, ScanLine, ShieldCheck, Trash2, TriangleAlert, jsxRuntimeExports, reactExports } from "../vendor.js";
import { getJingJieApi } from "../lib/app-info.js";
import { formatBytes$1 } from "../lib/format.js";
const PHASE_LABEL = {
  starting: "正在准备已验证计划",
  "file-cache": "正在清理可重建缓存",
  "recycle-bin": "正在永久清空回收站",
  "system-maintenance": "正在执行 Windows 官方维护",
  cancelling: "正在停止",
  completed: "清理完成",
  cancelled: "已停止",
  interrupted: "上次任务已中断"
};
function AggressivePanel() {
  const [phase, setPhase] = reactExports.useState("idle");
  const [report, setReport] = reactExports.useState();
  const [selected, setSelected] = reactExports.useState(/* @__PURE__ */ new Set());
  const [progress, setProgress] = reactExports.useState();
  const [cleanup, setCleanup] = reactExports.useState();
  const [error, setError] = reactExports.useState();
  reactExports.useEffect(() => {
    const api = getJingJieApi();
    const unsubscribe = api.onAggressiveProgress((next) => {
      setProgress(next);
      if (["starting", "file-cache", "recycle-bin", "system-maintenance", "cancelling"].includes(next.phase)) setPhase("cleaning");
    });
    void api.getAggressiveProgress().then((current) => {
      if (!current) return;
      setProgress(current);
      if (["starting", "file-cache", "recycle-bin", "system-maintenance", "cancelling"].includes(current.phase)) setPhase("cleaning");
    }).catch(() => void 0);
    return unsubscribe;
  }, []);
  const selectedCandidates = reactExports.useMemo(
    () => report?.candidates.filter((candidate) => selected.has(candidate.id)) ?? [],
    [report, selected]
  );
  const recycleSelected = selected.has("recycle-bin");
  const scan = async () => {
    setError(void 0);
    setCleanup(void 0);
    setProgress(void 0);
    setPhase("scanning");
    try {
      const next = await getJingJieApi().scanAggressive();
      setReport(next);
      setSelected(new Set(next.candidates.filter((candidate) => candidate.selectedByDefault).map((candidate) => candidate.id)));
      setPhase(next.cancelled ? "cancelled" : "review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "全面扫描未完成，请重试。");
      setPhase("error");
    }
  };
  const clean = async () => {
    if (!report || selected.size === 0) return;
    setError(void 0);
    setProgress(void 0);
    setCleanup(void 0);
    setPhase("cleaning");
    try {
      const result = await getJingJieApi().cleanAggressive(report.taskId, report.candidates.filter((candidate) => selected.has(candidate.id)).map((candidate) => candidate.id));
      setCleanup(result);
      setPhase(result.cancelled ? "cancelled" : "completed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "激进清理未完成，请重新扫描。");
      setPhase("error");
    }
  };
  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const percent = progress?.totalCount ? Math.min(100, Math.round(progress.processedCount / progress.totalCount * 100)) : 0;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "aggressive-console", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "aggressive-heading", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-label aggressive-label", children: "Aggressive · verified" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "更深一层，但不越界" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "扩大到已证明可重建的缓存与 Windows 官方维护；未知内容继续保留。" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "aggressive-status", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "永久保护已启用" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: "正向白名单 · 双重路径校验" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "protection-ledger", "aria-label": "永久保护范围", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ledger-title", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
          "保留边界账本"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: "这条边界不会随扫描结果改变" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "protection-track", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "protection-cells", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(FolderLock, {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "个人目录" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "桌面 · 文档 · 下载 · 图片 · 视频 · 音乐" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Cloud, {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "全部云同步根" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: report ? `已保护 ${report.protectedSummary.cloudRoots} 个同步根` : "扫描时识别重定向与物理位置" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Database, {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "浏览器持久数据" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "书签、密码、历史、Cookie、扩展、网站数据" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(PackageCheck, {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "软件账户与项目" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "设置、插件、存档、登录信息和数据库" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(HardDrive, {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "Windows 核心能力" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "启动、恢复、驱动、安装缓存、分页和休眠" })
        ] })
      ] })
    ] }),
    phase === "idle" || phase === "error" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "aggressive-intro", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "aggressive-scope", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "本次可扩展检查" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "应用缓存 · 着色器 · 开发下载缓存 · 回收站 · Windows 维护" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "只扫描目录册中的固定位置，不凭文件名猜测“垃圾”，也不强制关闭软件。" })
      ] }),
      error ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "aggressive-error", children: error }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "primary aggressive-primary", onClick: scan, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ScanLine, {}),
        "全面扫描"
      ] })
    ] }) : null,
    phase === "scanning" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "aggressive-scanning", "aria-busy": "true", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "scan-sweep", children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "正在建立可执行计划" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "逐个验证目录册、重解析点、回收站容量和系统支持能力。" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary", onClick: () => getJingJieApi().cancelAggressiveScan(), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CircleStop, {}),
        "取消扫描"
      ] })
    ] }) : null,
    report && phase === "review" ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "aggressive-summary", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: formatBytes$1(report.totalBytes) }),
          "可释放容量"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: report.totalItemCount }),
          "个文件或动作"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: selected.size }),
          "项计划已选"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "aggressive-groups", children: report.categories.map((category) => {
        const candidates = report.candidates.filter((candidate) => candidate.categoryId === category.id);
        return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "aggressive-group", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Gauge, {}),
              category.label
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: category.status === "ready" ? `${category.itemCount} 项 · ${formatBytes$1(category.sizeBytes)}` : category.message ?? "本次没有可清理内容" })
          ] }),
          candidates.map((candidate) => /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: `aggressive-row ${selected.has(candidate.id) ? "selected" : ""}`, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", "aria-label": `选择 ${candidate.label}`, checked: selected.has(candidate.id), onChange: () => toggle(candidate.id) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "aggressive-row-copy", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: candidate.label }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("small", { children: [
                candidate.itemCount,
                " 项 · ",
                candidate.sizeIsEstimate ? "容量由系统执行后确认" : formatBytes$1(candidate.sizeBytes)
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "aggressive-effect", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "影响" }),
              candidate.impact
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "aggressive-preserve", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(Check, {}),
              /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "仍会保留" }),
              candidate.preservationSummary
            ] })
          ] }, candidate.id))
        ] }, category.id);
      }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "aggressive-dock", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          recycleSelected ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "irreversible-warning", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(TriangleAlert, {}),
            "回收站内容将永久删除，净界无法恢复"
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "selection-note", children: [
            "已选 ",
            selectedCandidates.reduce((sum, candidate) => sum + candidate.itemCount, 0),
            " 个文件或动作"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: "缓存删除后可能在首次打开时短暂重建；个人和持久数据不在计划中。" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "aggressive-dock-actions", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary dark", onClick: scan, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, {}),
            "重新扫描"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "primary aggressive-primary", disabled: !selected.size, onClick: clean, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, {}),
            "执行已选 ",
            selected.size,
            " 项"
          ] })
        ] })
      ] })
    ] }) : null,
    phase === "cleaning" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "aggressive-progress", "aria-live": "polite", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-label", children: "Execution ledger" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: progress?.cancellationPending ? "正在完成当前系统任务" : progress ? PHASE_LABEL[progress.phase] : "正在准备清理" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
          percent,
          "%"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "aggressive-progress-track", role: "progressbar", "aria-label": "激进清理进度", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { transform: `scaleX(${percent / 100})` } }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "aggressive-progress-stats", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          progress?.processedCount ?? 0,
          " / ",
          progress?.totalCount ?? report?.totalItemCount ?? 0
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "已释放 ",
          formatBytes$1(progress?.freedBytes ?? 0)
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "跳过 ",
          progress?.skippedCount ?? 0
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "失败 ",
          progress?.failedCount ?? 0
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: progress?.cancellationPending ? "此 Windows 官方动作不能安全中断，结束后不会再开始下一项。" : "每个文件都在删除前复核；被占用或发生变化的内容会跳过。" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary dark", onClick: () => getJingJieApi().cancelAggressiveCleanup(), disabled: progress?.phase === "cancelling", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(CircleStop, {}),
        progress?.phase === "cancelling" ? "正在停止…" : "停止清理"
      ] })
    ] }) : null,
    cleanup && (phase === "completed" || phase === "cancelled") ? /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "aggressive-result", "aria-live": "polite", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "result-main", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Check, {}) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: cleanup.cancelled ? "已按请求停止" : "激进清理完成" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("strong", { children: [
            "已释放 ",
            formatBytes$1(cleanup.freedBytes)
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "未处理内容仍保留在原位置。" })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "result-ledger", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "成功 ",
          cleanup.succeededCount
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "跳过 ",
          cleanup.skippedCount
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "权限不足 ",
          cleanup.permissionDeniedCount
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "软件占用 ",
          cleanup.lockedCount
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "需要重启 ",
          cleanup.restartRequiredCount
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "secondary", onClick: scan, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(RotateCcw, {}),
        "再次扫描"
      ] })
    ] }) : null
  ] });
}

export { AggressivePanel, PHASE_LABEL };
