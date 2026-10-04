import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableResult, NON_RETRYABLE_SKIP_REASONS } from "../src/main/retry-policy.js";

// 这份判据只有一个真作用：闸门拦下来的东西不许被"重试"磨掉。
// 所以最该红的不是"能不能重试"，而是"策略拒绝过的项目有没有又被放回去"。
test("策略拒绝的结果永远不可重试（重试等于磨掉闸门）", () => {
  for (const reason of ["protected-root", "symbolic-link", "startup-entry-protected",
    "standard-uninstall-not-allowed", "outside-rule-root", "unsafe-rule-root", "unknown-rule"]) {
    assert.ok(NON_RETRYABLE_SKIP_REASONS.has(reason), `${reason} 没登记进不可重试名单`);
    for (const status of ["failed", "skipped"]) {
      assert.equal(isRetryableResult({ status, reason }), false,
        `${reason} 在 status=${status} 下被判成可重试`);
    }
  }
});

test("快照过期的项不可重试，正确做法是重新扫描", () => {
  for (const reason of ["changed-since-scan", "changed-since-inventory", "not-found", "mode-mismatch", "rule-root"]) {
    assert.equal(isRetryableResult({ status: "skipped", reason }), false,
      `${reason} 的 id 描述的是扫描时的世界，重发只会再跳一次`);
  }
});

test("真的失败过一次的动作仍然可以重试", () => {
  assert.equal(isRetryableResult({ status: "failed", reason: "io-error" }), true);
  assert.equal(isRetryableResult({ status: "failed", reason: null }), true);
});

test("成功项不在重试队列里", () => {
  assert.equal(isRetryableResult({ status: "success", reason: null }), false);
});

test("非对象入参不当成可重试", () => {
  for (const bad of [undefined, null, "failed", 42, []]) {
    assert.equal(isRetryableResult(bad), false);
  }
});
