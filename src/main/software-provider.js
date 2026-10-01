/**
 * software-provider.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * software provider adapter (PowerShell inventory + policy).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { normalizeInstalledSoftware } from "./software-inventory.js";
import { applySoftwarePolicy } from "./software-policy.js";
class SoftwareProvider {
  constructor(runner, environment) {
    this.runner = runner;
    this.environment = environment;
  }
  runner;
  environment;
  async list() {
    const records = await this.runner.runScript("software-inventory");
    if (!Array.isArray(records)) throw new Error("invalid-software-inventory");
    return normalizeInstalledSoftware(records).map((entry) => applySoftwarePolicy(entry, this.environment));
  }
}

export {
  SoftwareProvider
};
