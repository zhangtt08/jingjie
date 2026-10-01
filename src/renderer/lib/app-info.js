/**
 * lib/app-info.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * bridge accessor, product constants, known-failure wording.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
function getJingJieApi() {
  if (!window.jingjie) throw new Error("desktop-api-unavailable");
  return window.jingjie;
}
const APP_NAME = "净界";
const APP_VERSION = "0.2.0-beta.6";
const POLICY_VERSION = "POLICY 01.4";
const KNOWN_FAILURES = [
  ["invalid-clean-request", "清理请求未通过安全校验，请重新扫描后再试。"],
  ["invalid-aggressive-clean-request", "清理请求未通过安全校验，请重新扫描后再试。"],
  ["invalid-software-uninstall-request", "卸载请求未通过安全校验，请重新读取软件清单后再试。"],
  ["invalid-startup-request", "启动项请求未通过安全校验，请重新读取后再试。"],
  ["invalid-id-batch", "请求未通过安全校验，请重新读取后再试。"],
  ["unknown-task", "这次扫描结果已经失效，请重新扫描后再试。"],
  ["expired-task", "扫描结果已超过 15 分钟，请重新扫描后再试。"],
  ["unknown-item", "部分项目不在本次扫描结果里，请重新扫描后再试。"],
  ["scan-in-progress", "已有扫描正在进行，请等它结束。"],
  ["untrusted-renderer", "界面与主进程的信任校验失败，请重启净界。"],
  ["desktop-api-unavailable", "桌面接口不可用，请重启净界。"]
];
function describeFailure(reason, fallback2) {
  const raw = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  for (const [code, message] of KNOWN_FAILURES) {
    if (raw.includes(code)) return message;
  }
  return fallback2;
}
