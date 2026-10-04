/**
 * retry-policy.js -- ONE shared judgement for "may this result be re-run?".
 *
 * PlanController.retry() and every owning controller (cleaner / aggressive / software / startup)
 * decide together whether a failed item can be retried: the controller keeps retryable ids alive
 * in its scan snapshot, and the plan only re-sends ids the policy allows. If the two lists drifted,
 * retries would either die on "unknown-item" or wear a guard down -- so the list lives here only once.
 */

/**
 * Skipping reasons that must NEVER be auto-retried:
 *  - policy refusals (protected roots, symbolic links, disallowed categories) -- retrying a
 *    deliberate refusal is just a way to wear the guard down;
 *  - stale-snapshot mismatches (changed-since-scan) -- the id describes a file as it was at scan
 *    time; re-sending it can only skip again. The honest remedy is "refresh the plan".
 *  - not-found -- the file is already gone; there is nothing left to do for that id.
 */
export const NON_RETRYABLE_SKIP_REASONS = new Set([
  "startup-entry-protected",
  "standard-uninstall-not-allowed",
  "unknown-rule",
  "mode-mismatch",
  "protected-root",
  "symbolic-link",
  "outside-rule-root",
  "unsafe-rule-root",
  "rule-root",
  "not-found",
  "changed-since-scan",
  "changed-since-inventory"
]);

/** @param {{status?: string, reason?: string|null}} result */
export function isRetryableResult(result) {
  if (!result || typeof result !== "object") return false;
  if (NON_RETRYABLE_SKIP_REASONS.has(result.reason)) return false;
  return result.status === "failed" || result.status === "skipped";
}
