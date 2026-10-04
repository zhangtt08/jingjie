/**
 * app.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * root component: view routing, cleanup orchestration, about dialog.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
import { ScanSearch, ShieldCheck, X, clientExports, jsxRuntimeExports, reactExports } from "./vendor.js";
import { AggressivePanel } from "./components/AggressivePanel.js";
import { HistoryPanel } from "./components/HistoryPanel.js";
import { MetricList } from "./components/MetricList.js";
import { QuarantinePanel } from "./components/QuarantinePanel.js";
import { ResultsPanel } from "./components/ResultsPanel.js";
import { ScanPanel } from "./components/ScanPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { SoftwarePanel } from "./components/SoftwarePanel.js";
import { StartupPanel } from "./components/StartupPanel.js";
import { APP_NAME, APP_VERSION, POLICY_VERSION, describeFailure, getJingJieApi } from "./lib/app-info.js";
const MESSAGE_TIMEOUT_MS = 8e3;
const CLEAN_BATCH_SIZE = 5e3;
function mergeCleanupReports(previous, next) {
  if (!previous) return next;
  return {
    ...next,
    requestedCount: previous.requestedCount + next.requestedCount,
    succeededCount: previous.succeededCount + next.succeededCount,
    failedCount: previous.failedCount + next.failedCount,
    freedBytes: previous.freedBytes + next.freedBytes,
    quarantinedBytes: previous.quarantinedBytes + next.quarantinedBytes,
    cancelled: next.cancelled,
    results: [...previous.results, ...next.results]
  };
}
function App() {
  const [view, setView] = reactExports.useState("overview");
  const [phase, setPhase] = reactExports.useState("idle");
  const [scanReport, setScanReport] = reactExports.useState();
  const [cleanupReport, setCleanupReport] = reactExports.useState();
  const [cleanupProgress, setCleanupProgress] = reactExports.useState();
  const [error, setError] = reactExports.useState();
  const [quarantine, setQuarantine] = reactExports.useState([]);
  const [history, setHistory] = reactExports.useState([]);
  const [loading, setLoading] = reactExports.useState(false);
  const [message, setMessage] = reactExports.useState();
  const [moduleMetrics, setModuleMetrics] = reactExports.useState({ softwareFailed: false, startupFailed: false });
  const [aboutOpen, setAboutOpen] = reactExports.useState(false);
  const [cleanBatch, setCleanBatch] = reactExports.useState();
  const cancelRequested = reactExports.useRef(false);
  reactExports.useEffect(() => {
    const api = getJingJieApi();
    const unsubscribe = api.onCleanupProgress((progress) => {
      setCleanupProgress(progress);
      if (progress.phase === "starting" || progress.phase === "deleting" || progress.phase === "cancelling") setPhase("cleaning");
    });
    void api.getCleanupProgress().then((progress) => {
      if (!progress) return;
      setCleanupProgress(progress);
      if (progress.phase === "starting" || progress.phase === "deleting" || progress.phase === "cancelling") setPhase("cleaning");
    }).catch(() => void 0);
    return unsubscribe;
  }, []);
  reactExports.useEffect(() => {
    if (view === "overview") {
      Promise.allSettled([getJingJieApi().listSoftware(), getJingJieApi().listStartupItems()]).then(([software, startup]) => {
        setModuleMetrics({
          software: software.status === "fulfilled" && software.value?.items ? software.value.items.filter((item) => item.standardUninstallAllowed).length : void 0,
          startup: startup.status === "fulfilled" && startup.value?.items ? startup.value.items.filter((item) => item.canDisable).length : void 0,
          softwareFailed: software.status === "rejected",
          startupFailed: startup.status === "rejected"
        });
      });
    } else if (view === "quarantine") {
      setLoading(true);
      getJingJieApi().listQuarantine().then(setQuarantine).catch(() => setMessage("无法读取隔离索引。")).finally(() => setLoading(false));
    } else if (view === "history") {
      getJingJieApi().getHistory().then(setHistory).catch(() => setHistory([]));
    }
  }, [view]);
  reactExports.useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(void 0), MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [message]);
  reactExports.useEffect(() => {
    if (!aboutOpen) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setAboutOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aboutOpen]);
  const startScan = async () => {
    setError(void 0);
    setCleanupReport(void 0);
    setCleanupProgress(void 0);
    setPhase("scanning");
    try {
      const report = await getJingJieApi().scan();
      setScanReport(report);
      setPhase(report.cancelled ? "cancelled" : "review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "扫描未完成，请重试。");
      setPhase("error");
    }
  };
  const openCleanup = () => {
    setView("cleanup");
    if (phase === "idle" || phase === "error" || phase === "cancelled") void startScan();
  };
  const cancelScan = async () => {
    await getJingJieApi().cancelScan();
  };
  const clean = async () => {
    if (!scanReport?.items.length) return;
    setError(void 0);
    setCleanupProgress(void 0);
    setCleanupReport(void 0);
    setPhase("cleaning");
    cancelRequested.current = false;
    const itemIds = scanReport.items.map((item) => item.id);
    const batches = [];
    for (let start = 0; start < itemIds.length; start += CLEAN_BATCH_SIZE) {
      batches.push(itemIds.slice(start, start + CLEAN_BATCH_SIZE));
    }
    let merged;
    try {
      for (let index = 0; index < batches.length; index += 1) {
        if (cancelRequested.current) break;
        setCleanBatch({ index: index + 1, total: batches.length });
        const result = await getJingJieApi().clean(scanReport.taskId, batches[index]);
        merged = mergeCleanupReports(merged, result);
        setCleanupReport(merged);
        if (result.cancelled) break;
      }
      setPhase(merged?.cancelled ? "cancelled" : "completed");
    } catch (reason) {
      setError(describeFailure(reason, "清理未完成，请重新扫描。"));
      setPhase("error");
    } finally {
      setCleanBatch(void 0);
    }
  };
  const cancelCleanup = async () => {
    cancelRequested.current = true;
    await getJingJieApi().cancelCleanup();
  };
  const restore = async (id) => {
    const result = await getJingJieApi().restoreQuarantine(id);
    if (result.restored) {
      setMessage("项目已恢复到原位置。");
      setQuarantine(await getJingJieApi().listQuarantine());
    } else {
      setMessage(result.reason === "target-exists" ? "原位置已有同名文件，未执行覆盖。" : "该隔离项目已不存在。");
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "app-shell", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(Sidebar, { active: view, onSelect: setView, onOpenAbout: () => setAboutOpen(true) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("main", { className: "main-area", children: [
      view === "overview" ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "topbar", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-label", children: "System hygiene console" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "系统状态，一眼看清" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "只扫描明确允许的缓存目录，执行前再次校验。" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "status-chip", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
            "核心区域已保护"
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "module-metrics", "aria-label": "系统优化概览", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: moduleMetrics.software ?? "—" }),
            moduleMetrics.software !== void 0 ? `${moduleMetrics.software} 个可标准卸载` : moduleMetrics.softwareFailed ? "软件清单读取失败，可稍后重试" : "正在读取软件清单"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: moduleMetrics.startup ?? "—" }),
            moduleMetrics.startup !== void 0 ? `${moduleMetrics.startup} 个可优化启动项` : moduleMetrics.startupFailed ? "启动项读取失败，可稍后重试" : "正在读取启动项"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: scanReport?.items.length ?? "—" }),
            scanReport ? `${scanReport.items.length} 个可清理文件` : "扫描后显示可清理文件"
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "overview-launch", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: scanReport ? `上次扫描发现 ${scanReport.items.length} 个可清理文件` : "深度清理：用户临时文件、系统 Temp、浏览器缓存、崩溃转储" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "只处理 24 小时以上的普通文件；执行前重新验证物理路径、文件大小和修改时间。" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "primary", onClick: openCleanup, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(ScanSearch, {}),
            "开始深度扫描"
          ] })
        ] }),
        cleanupReport ? /* @__PURE__ */ jsxRuntimeExports.jsx(ResultsPanel, { report: cleanupReport }) : null
      ] }) : null,
      view === "cleanup" ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "topbar", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-label", children: "Verified deep cleanup" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "深度清理" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "扫描允许的缓存目录，逐项复核后再执行。" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "status-chip", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
            "核心区域已保护"
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "dashboard-grid", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(ScanPanel, { phase, report: scanReport, cleanup: cleanupReport, progress: cleanupProgress, error, batch: cleanBatch, onScan: startScan, onCancel: cancelScan, onClean: clean, onCancelCleanup: cancelCleanup }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(MetricList, { categories: scanReport?.categories })
        ] }),
        cleanupReport ? /* @__PURE__ */ jsxRuntimeExports.jsx(ResultsPanel, { report: cleanupReport }) : null
      ] }) : null,
      view === "quarantine" ? /* @__PURE__ */ jsxRuntimeExports.jsx(
        QuarantinePanel,
        {
          entries: quarantine,
          loading,
          message,
          onRestore: restore,
          onDismissMessage: () => setMessage(void 0)
        }
      ) : null,
      view === "history" ? /* @__PURE__ */ jsxRuntimeExports.jsx(HistoryPanel, { entries: history }) : null,
      view === "software" ? /* @__PURE__ */ jsxRuntimeExports.jsx(SoftwarePanel, {}) : null,
      view === "startup" ? /* @__PURE__ */ jsxRuntimeExports.jsx(StartupPanel, {}) : null,
      view === "aggressive" ? /* @__PURE__ */ jsxRuntimeExports.jsx(AggressivePanel, {}) : null
    ] }),
    aboutOpen ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "modal-backdrop", onClick: () => setAboutOpen(false), children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "section",
      {
        className: "about-dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "关于净界",
        onClick: (event) => event.stopPropagation(),
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "brand-mark", "aria-hidden": "true" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: APP_NAME }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("small", { children: "Windows 深度清理 · 软件卸载 · 启动优化" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-command", "aria-label": "关闭关于净界", onClick: () => setAboutOpen(false), children: /* @__PURE__ */ jsxRuntimeExports.jsx(X, {}) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("dl", { className: "about-meta", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { children: "版本" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { children: APP_VERSION })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { children: "保护策略" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { children: POLICY_VERSION })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { children: "数据处理" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { children: "全部在本机完成，不上传云端" })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "about-boundary", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, {}),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "不可关闭的保护边界" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Windows 组件、运行库、驱动、安全软件、VPN、输入法、个人文件夹与净界自身始终受保护策略约束。" })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "about-note", children: "当前安装包未使用商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”。净界不是杀毒或驱动管理工具，重要电脑请保留独立备份。" })
        ]
      }
    ) }) : null
  ] });
}
clientExports.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(App, {}) })
);


export { App, CLEAN_BATCH_SIZE, MESSAGE_TIMEOUT_MS, mergeCleanupReports };
