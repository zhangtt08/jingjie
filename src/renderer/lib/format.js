/**
 * lib/format.js -- recovered from the packaged renderer bundle (out/renderer/assets/index-*.js, unminified).
 * byte formatting helpers.
 * The bundle kept the original function and variable names; JSX was already compiled to
 * jsx()/jsxs() calls by the automatic runtime, so this source runs as-is against
 * src/renderer/vendor.js with no bundler and no install step. See docs/SOURCE-RECOVERY.md.
 */
function formatBytes$1(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}
function formatBytes(value) {
  if (value === null) return "大小未知";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unit]}`;
}
