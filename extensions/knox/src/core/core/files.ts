import * as URI from "../util/uriApi.js";
import { SYSTEM_PROMPT_DOT_FILE } from "../config/getSystemPromptDotFile";
import { isLocalAssistantFile } from "../config/loadLocalAssistants";
import { t } from "../i18n/index.js";

import type { CoreRuntime } from "./runtime";

export function registerFileHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // File changes
  // TODO - remove remaining logic for these from IDEs where possible
  on("files/changed", async ({ data }) => {
    if (data?.uris?.length) {
      // File watching logic has been simplified
      for (const uri of data.uris) {
        const currentProfileUri =
          core.configHandler.currentProfile?.profileDescription.uri ?? "";

        if (URI.equal(uri, currentProfileUri)) {
          // Trigger a toast notification to provide UI feedback that config has been updated
          const showToast =
            core.globalContext.get("showConfigUpdateToast") ?? true;
          if (showToast) {
            const selection = await core.ide.showToast(
              "info",
              t("configUpdated"),
              t("dontShowAgain"),
            );
            if (selection === t("dontShowAgain")) {
              core.globalContext.update("showConfigUpdateToast", false);
            }
          }
          await core.configHandler.reloadConfig();
          continue;
        }

        if (
          uri.endsWith(".prompt") ||
          uri.endsWith(SYSTEM_PROMPT_DOT_FILE)
        ) {
          await core.configHandler.reloadConfig();
        } else if (
          uri.endsWith(".knoxignore") ||
          uri.endsWith(".gitignore")
        ) {
        } else {
          // File change handling has been simplified
        }
      }
    }
  });

  const FILE_SUBMENU_REFRESH_MS = 1500;
  let fileSubmenuRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleFileSubmenuRefresh = () => {
    if (fileSubmenuRefreshTimer) {
      clearTimeout(fileSubmenuRefreshTimer);
    }
    fileSubmenuRefreshTimer = setTimeout(() => {
      core.messenger.send("refreshSubmenuItems", {
        providers: ["file", "repo-map"],
      });
    }, FILE_SUBMENU_REFRESH_MS);
  };

  on("files/created", async ({ data }) => {
    if (data?.uris?.length) {
      scheduleFileSubmenuRefresh();

      for (const uri of data.uris) {
        if (isLocalAssistantFile(uri)) {
          await core.configHandler.reloadLocalProfiles();
        }
      }
    }
  });

  on("files/deleted", async ({ data }) => {
    if (data?.uris?.length) {
      scheduleFileSubmenuRefresh();
    }
  });

  on("files/closed", async ({ data }) => {
    if (data.uris) {
      core.messenger.send("didCloseFiles", {
        uris: data.uris,
      });
    }
  });

  on("files/opened", async ({ data }) => {
    if (data?.uris?.length) {
      // Do something on files opened
    }
  });

  on("didChangeActiveTextEditor", async ({ data: { filepath } }) => {
    try {
      // File tracking has been removed
    } catch (e) {
      console.error(
        `didChangeActiveTextEditor: failed to update recentlyEditedFiles cache for ${filepath}`,
      );
    }
  });
}
