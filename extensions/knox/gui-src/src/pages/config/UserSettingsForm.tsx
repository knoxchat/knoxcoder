import {
  DEFAULT_UI_SETTINGS,
  SharedConfigSchema,
  modifyAnyConfigWithSharedConfig,
} from "core/config/sharedConfig";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AGENT_PROFILE_DEFAULTS } from "core/config/agentProfile";
import {
  DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES,
  MAX_VIEW_SUBDIRECTORY_MAX_FILES,
  MIN_VIEW_SUBDIRECTORY_MAX_FILES,
} from "core/tools/builtIn";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { NumberInput } from "../../components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Button } from "../../components/ui/button";
import { useFontSize } from "../../components/ui/font";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { updateConfig } from "../../redux/slices/configSlice";
import { CheckIcon, XMarkIcon } from "../../svg-icons";
import { setLocalStorage } from "../../util/localStorage";
import {
  switchLanguage,
  getCurrentLanguage,
  LANGUAGE_NAMES,
  type SupportedLanguage,
} from "../../i18n";

// Settings form component using shadcn/ui components

export function UserSettingsForm() {
  const { t } = useTranslation();
  const [currentLang, setCurrentLang] =
    useState<SupportedLanguage>(getCurrentLanguage());
  /////// User settings section //////
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((state) => state.config.config);

  function handleUpdate(sharedConfig: SharedConfigSchema) {
    // Optimistic update
    const updatedConfig = modifyAnyConfigWithSharedConfig(config, sharedConfig);
    dispatch(updateConfig(updatedConfig));
    // IMPORTANT no need for model role updates (separate logic for selected model roles)
    // simply because this function won't be used to update model roles

    // Actual update to core which propagates back with config update event
    ideMessenger.post("config/updateSharedConfig", sharedConfig);
  }

  // Workspace prompts
  const promptPath = config.experimental?.promptPath || "";
  const [formPromptPath, setFormPromptPath] = useState(promptPath);
  const cancelChangePromptPath = () => {
    setFormPromptPath(promptPath);
  };
  const handleSubmitPromptPath = () => {
    handleUpdate({
      promptPath: formPromptPath || "",
    });
  };

  useEffect(() => {
    // Necessary so that reformatted/trimmed values don't cause dirty state
    setFormPromptPath(promptPath);
  }, [promptPath]);

  const showSessionTabs =
    config.ui?.showSessionTabs ?? DEFAULT_UI_SETTINGS.showSessionTabs;
  const codeWrap = config.ui?.codeWrap ?? DEFAULT_UI_SETTINGS.codeWrap;
  const showChatScrollbar =
    config.ui?.showChatScrollbar ?? DEFAULT_UI_SETTINGS.showChatScrollbar;
  const displayRawMarkdown =
    config.ui?.displayRawMarkdown ?? DEFAULT_UI_SETTINGS.displayRawMarkdown;
  const disableSessionTitles =
    config.disableSessionTitles ?? DEFAULT_UI_SETTINGS.disableSessionTitles;

  const fontSize = useFontSize();
  const rawAgentProfile = config.experimental?.agentProfile;
  const agentProfile =
    rawAgentProfile === "systems" ||
    rawAgentProfile === "rust" ||
    rawAgentProfile === "auto"
      ? rawAgentProfile
      : "default";
  const profileDefaults =
    AGENT_PROFILE_DEFAULTS[
      agentProfile === "auto" ? "default" : agentProfile
    ];
  const agentMaxSteps =
    config.experimental?.agentMaxSteps ?? profileDefaults.maxSteps;
  const agentDoomLoopThreshold =
    config.experimental?.agentDoomLoopThreshold ??
    profileDefaults.doomLoopThreshold;
  const agentViewSubdirectoryMaxFiles =
    config.experimental?.agentViewSubdirectoryMaxFiles ??
    DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES;

  // Language switch handler
  const handleLanguageChange = (lang: SupportedLanguage) => {
    switchLanguage(lang);
    setCurrentLang(lang);
  };

  return (
    <div className="space-y-2 p-2">
      {/* Language Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-knoxcyan">{t("language")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <Label htmlFor="language-select" className="text-sm font-medium">
              {t("language")}
            </Label>
            <Select
              value={currentLang}
              onValueChange={(value: SupportedLanguage) =>
                handleLanguageChange(value)
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{LANGUAGE_NAMES.en}</SelectItem>
                <SelectItem value="zh">{LANGUAGE_NAMES.zh}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Interface Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-knoxcyan">
            {t("interfaceSettings")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <Label htmlFor="show-session-tabs" className="text-sm font-medium">
              {t("showSessionTabs")}
            </Label>
            <Switch
              id="show-session-tabs"
              checked={showSessionTabs}
              onCheckedChange={() =>
                handleUpdate({
                  showSessionTabs: !showSessionTabs,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="code-wrap" className="text-sm font-medium">
              {t("codeBlockAutoWrap")}
            </Label>
            <Switch
              id="code-wrap"
              checked={codeWrap}
              onCheckedChange={() =>
                handleUpdate({
                  codeWrap: !codeWrap,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="show-scrollbar" className="text-sm font-medium">
              {t("showChatScrollbar")}
            </Label>
            <Switch
              id="show-scrollbar"
              checked={showChatScrollbar}
              onCheckedChange={() =>
                handleUpdate({
                  showChatScrollbar: !showChatScrollbar,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="auto-name-titles" className="text-sm font-medium">
              {t("autoNameSessionTitles")}
            </Label>
            <Switch
              id="auto-name-titles"
              checked={!disableSessionTitles}
              onCheckedChange={() =>
                handleUpdate({
                  disableSessionTitles: !disableSessionTitles,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label
              htmlFor="markdown-formatting"
              className="text-sm font-medium"
            >
              {t("markdownFormatting")}
            </Label>
            <Switch
              id="markdown-formatting"
              checked={!displayRawMarkdown}
              onCheckedChange={() =>
                handleUpdate({
                  displayRawMarkdown: !displayRawMarkdown,
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Accessibility & Display Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-knoxcyan">
            {t("accessibilityDisplay")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <Label htmlFor="font-size" className="text-sm font-medium">
              {t("fontSize")}
            </Label>
            <NumberInput
              value={fontSize}
              onChange={(val) => {
                setLocalStorage("fontSize", val);
                handleUpdate({
                  fontSize: val,
                });
              }}
              min={7}
              max={50}
            />
          </div>
        </CardContent>
      </Card>

      {/* Agent Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-knoxcyan">{t("agentSettings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="agent-profile" className="text-sm font-medium">
                {t("agentProfile")}
              </Label>
              <span className="text-muted-foreground text-xs">
                {t("agentProfileHint")}
              </span>
            </div>
            <Select
              value={agentProfile}
              onValueChange={(
                value: "default" | "systems" | "rust" | "auto",
              ) => {
                if (value === "auto") {
                  handleUpdate({ agentProfile: value });
                  return;
                }
                const next = AGENT_PROFILE_DEFAULTS[value];
                handleUpdate({
                  agentProfile: value,
                  agentDoomLoopThreshold: next.doomLoopThreshold,
                  agentVerifyMode: next.verifyMode,
                  agentVerifyCommand: next.verifyCommand,
                });
              }}
            >
              <SelectTrigger className="w-36" id="agent-profile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("agentProfileDefault")}</SelectItem>
                <SelectItem value="rust">{t("agentProfileRust")}</SelectItem>
                <SelectItem value="systems">{t("agentProfileSystems")}</SelectItem>
                <SelectItem value="auto">{t("agentProfileAuto")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="agent-max-steps" className="text-sm font-medium">
                {t("agentMaxSteps")}
              </Label>
              <span className="text-muted-foreground text-xs">
                {t("agentMaxStepsHint")}
              </span>
            </div>
            <NumberInput
              value={agentMaxSteps}
              onChange={(val) => {
                handleUpdate({
                  agentMaxSteps: val,
                });
              }}
              min={0}
              max={1000}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="agent-doom-loop"
                className="text-sm font-medium"
              >
                {t("agentDoomLoopThreshold")}
              </Label>
              <span className="text-muted-foreground text-xs">
                {t("agentDoomLoopThresholdHint")}
              </span>
            </div>
            <NumberInput
              value={agentDoomLoopThreshold}
              onChange={(val) => {
                handleUpdate({
                  agentDoomLoopThreshold: val,
                });
              }}
              min={0}
              max={20}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="agent-max-files"
                className="text-sm font-medium"
              >
                {t("agentViewSubdirectoryMaxFiles")}
              </Label>
              <span className="text-muted-foreground text-xs">
                {t("agentViewSubdirectoryMaxFilesHint")}
              </span>
            </div>
            <NumberInput
              value={agentViewSubdirectoryMaxFiles}
              onChange={(val) => {
                handleUpdate({
                  agentViewSubdirectoryMaxFiles: val,
                });
              }}
              min={MIN_VIEW_SUBDIRECTORY_MAX_FILES}
              max={MAX_VIEW_SUBDIRECTORY_MAX_FILES}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("agentPolicyHint")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
