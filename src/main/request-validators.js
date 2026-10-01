/**
 * request-validators.js -- recovered from the packaged main bundle (out/main/main.js).
 * strict IPC request shape checks (ids only, never paths or commands).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 *
 * SECURITY-REVIEW S-02 (this repository's change): every destructive request now has to carry
 * an explicit `confirm: true`. The shipped 0.2.0-beta.6 accepted { taskId, itemIds } and acted --
 * the only "are you sure" gate was a button in the renderer, so any renderer bug, any replay, or
 * any future caller could trigger a delete without ever showing the preview. The rule now lives
 * at the boundary, next to the shape check, and irreversible actions (emptying the recycle bin)
 * need `irreversibleAck: true` on top of that.
 */
const MAX_ID_LENGTH = 128;

function readIdBatch(value, maximumItems, { errorName, allowConfirm }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorName);
  const record = value;
  const keys = Object.keys(record).sort();
  const expected = allowConfirm ? ["confirm", "itemIds", "taskId"] : ["itemIds", "taskId"];
  const withAck = allowConfirm ? ["confirm", "irreversibleAck", "itemIds", "taskId"] : expected;
  if (keys.join(",") !== expected.join(",") && keys.join(",") !== withAck.join(",")) throw new Error(errorName);
  if (typeof record.taskId !== "string" || record.taskId.length < 1 || record.taskId.length > MAX_ID_LENGTH) throw new Error(errorName);
  if (!Array.isArray(record.itemIds) || record.itemIds.length < 1 || record.itemIds.length > maximumItems) throw new Error(errorName);
  if (!record.itemIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH)) throw new Error(errorName);
  if (new Set(record.itemIds).size !== record.itemIds.length) throw new Error(errorName);
  if (record.confirm !== void 0 && typeof record.confirm !== "boolean") throw new Error(errorName);
  if (record.irreversibleAck !== void 0 && typeof record.irreversibleAck !== "boolean") throw new Error(errorName);
  const request = { taskId: record.taskId, itemIds: [...record.itemIds] };
  if (allowConfirm) {
    request.confirm = record.confirm === true;
    if (record.irreversibleAck !== void 0) request.irreversibleAck = record.irreversibleAck === true;
  }
  return request;
}

export function validateSoftwareUninstallRequest(value) {
  try {
    return readIdBatch(value, 100, { errorName: "invalid-software-uninstall-request", allowConfirm: true });
  } catch (error) {
    if (error.message === "invalid-id-batch") throw new Error("invalid-software-uninstall-request");
    throw error;
  }
}

export function validateStartupDisableRequest(value) {
  try {
    return readIdBatch(value, 100, { errorName: "invalid-startup-request", allowConfirm: true });
  } catch {
    throw new Error("invalid-startup-request");
  }
}

export function validateIdBatch(value, maximumItems) {
  return readIdBatch(value, maximumItems, { errorName: "invalid-id-batch", allowConfirm: false });
}

export function validateCleanRequest(value) {
  try {
    return readIdBatch(value, 1e4, { errorName: "invalid-clean-request", allowConfirm: true });
  } catch {
    throw new Error("invalid-clean-request");
  }
}

export function validateAggressiveCleanRequest(value) {
  try {
    return readIdBatch(value, 100, { errorName: "invalid-aggressive-clean-request", allowConfirm: true });
  } catch {
    throw new Error("invalid-aggressive-clean-request");
  }
}

export function validateId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_ID_LENGTH) throw new Error("invalid-id");
  return value;
}

/** The single wording used everywhere a destructive call was refused for lack of confirmation. */
export function assertConfirmed(request, errorName = "confirmation-required") {
  if (request?.confirm !== true) throw new Error(errorName);
}
