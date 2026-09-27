import { ConfigResult, parseConfigYaml } from "knoxdev-package/config-yaml";

import { KnoxConfig, IDE, IdeSettings } from "../../index.js";
import { t } from "../../i18n/index.js";
import { getPrimaryConfigFilePath } from "../../util/paths.js";
import { localPathToUri } from "../../util/pathToUri.js";
import { getUriPathBasename } from "../../util/uri.js";
import { ProfileDescription } from "../ProfileLifecycleManager.js";

import doLoadConfig from "./doLoadConfig.js";
import { IProfileLoader } from "./IProfileLoader.js";

export default class LocalProfileLoader implements IProfileLoader {
  static ID = "local";

  constructor(
    private ide: IDE,
    private ideSettingsPromise: Promise<IdeSettings>,
    private writeLog: (message: string) => Promise<void>,
    private overrideAssistantFile?:
      | { path: string; content: string }
      | undefined,
  ) {
    const description: ProfileDescription = {
      id: overrideAssistantFile?.path ?? LocalProfileLoader.ID,
      profileType: "local",
      fullSlug: {
        ownerSlug: "",
        packageSlug: "",
        versionSlug: "",
      },
      iconUrl: "",
      title: overrideAssistantFile?.path
        ? getUriPathBasename(overrideAssistantFile.path)
        : "Knox",
      errors: undefined,
      uri:
        overrideAssistantFile?.path ??
        localPathToUri(getPrimaryConfigFilePath()),
      rawYaml: undefined,
    };
    this.description = description;
    if (overrideAssistantFile?.content) {
      try {
        const parsedAssistant = parseConfigYaml(
          overrideAssistantFile?.content ?? "",
        );
        this.description.title = parsedAssistant.name;
      } catch (e) {
        console.error(t("failedToParseAssistantFile"), e);
      }
    }
  }
  description: ProfileDescription;

  async doLoadConfig(): Promise<ConfigResult<KnoxConfig>> {
    const result = await doLoadConfig(
      this.ide,
      this.ideSettingsPromise,
      this.writeLog,
      undefined,
      this.description.id,
      this.overrideAssistantFile?.path,
    );

    this.description.errors = result.errors;

    return result;
  }

  setIsActive(isActive: boolean): void {}
}
