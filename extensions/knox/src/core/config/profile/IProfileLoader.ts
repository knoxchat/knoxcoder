// ProfileHandlers manage the loading of a config, allowing us to abstract over different ways of getting to a KnoxConfig

import { ConfigResult } from "knoxdev-package/config-yaml";

import { KnoxConfig } from "../../index.js";
import { ProfileDescription } from "../ProfileLifecycleManager.js";

// After we have the KnoxConfig, the ConfigHandler takes care of everything else (loading models, lifecycle, etc.)
export interface IProfileLoader {
  description: ProfileDescription;
  doLoadConfig(): Promise<ConfigResult<KnoxConfig>>;
  setIsActive(isActive: boolean): void;
}
