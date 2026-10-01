/**
 * startup-provider.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * startup provider adapter.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { normalizeStartupEntries } from "./startup-inventory.js";
import { applyStartupPolicy } from "./startup-policy.js";
import { classifyStartupEffect } from "./startup-effects.js";
class StartupProvider {
  constructor(runner, environment) {
    this.runner = runner;
    this.environment = environment;
  }
  runner;
  environment;
  async list() {
    const records = await this.runner.runScript("startup-inventory");
    if (!Array.isArray(records)) throw new Error("invalid-startup-inventory");
    return normalizeStartupEntries(records).map((entry) => {
      const protectedEntry = applyStartupPolicy(entry, this.environment);
      return { ...protectedEntry, effect: classifyStartupEffect(protectedEntry) };
    });
  }
}

export {
  StartupProvider
};
