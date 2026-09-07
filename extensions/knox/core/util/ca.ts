import { globalAgent } from "https";

import { t } from "../i18n/index.js";

export async function setupCa() {
  try {
    switch (process.platform) {
      case "darwin":
        // https://www.npmjs.com/package/mac-ca#usage
        const macCa = await import("mac-ca");
        macCa.addToGlobalAgent();
        break;
      case "win32":
        // https://www.npmjs.com/package/win-ca#caveats
        const winCa = await import("win-ca");
        winCa.inject("+");
        break;
      default: {
        // https://www.npmjs.com/package/system-ca
        const { systemCertsAsync } = await import("system-ca");
        globalAgent.options.ca = await systemCertsAsync();
        break;
      }
    }
  } catch (e) {
    console.warn(t("failedToSetupCa"), e);
  }
}
