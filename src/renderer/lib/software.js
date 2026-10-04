/**
 * lib/software.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * uninstall labels, failure wording, report merge.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
const UNINSTALL_BATCH_SIZE = 100;
function riskLabel(item) {
  if (!item.standardUninstallAllowed) return "系统保护";
  if (item.risk === "protected") return "谨慎卸载";
  if (item.risk === "caution") return "信息有限";
  return "标准卸载";
}
function sourceLabel$1(item) {
  if (item.source === "appx") return "Microsoft Store";
  return item.scope === "machine" ? "所有用户" : "当前用户";
}
function failureReason(reason, exitCode) {
  if (!reason) return exitCode === void 0 ? "卸载程序未报告原因" : `退出码 ${exitCode}`;
  if (reason === "timeout") return "卸载程序超时未结束";
  if (reason === "uac-cancelled") return "已取消 Windows UAC 授权";
  if (reason === "process-launch-failed") return "无法启动卸载程序";
  if (reason === "elevation-helper-failed") return "提权执行器未能完成";
  if (reason.startsWith("exit-code-")) return `卸载程序返回退出码 ${reason.slice("exit-code-".length)}`;
  return `卸载程序报告：${reason}`;
}
function mergeUninstallReports(previous, next) {
  if (!previous) return next;
  return {
    ...next,
    requestedCount: previous.requestedCount + next.requestedCount,
    succeededCount: previous.succeededCount + next.succeededCount,
    rebootRequiredCount: previous.rebootRequiredCount + next.rebootRequiredCount,
    failedCount: previous.failedCount + next.failedCount,
    skippedCount: previous.skippedCount + next.skippedCount,
    results: [...previous.results, ...next.results]
  };
}

export { UNINSTALL_BATCH_SIZE, failureReason, mergeUninstallReports, riskLabel, sourceLabel$1 };
