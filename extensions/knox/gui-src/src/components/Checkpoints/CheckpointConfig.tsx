import React, { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { Switch } from "../ui/switch";
import { cn } from "@/lib/utils";
import { Settings, X, Save, AlertCircle, CheckCircle, Info, HardDrive, Clock, FileText, Zap } from "lucide-react";

const STORAGE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

const LIMITS = {
  maxCheckpoints: { min: 1, max: 10000 },
  retentionDays: { min: 1, max: 365 },
  maxStorageBytes: { min: 1024 * 1024 },
  maxFilesPerCheckpoint: { min: 1, max: 100000 },
  maxFileSizeBytes: { min: 1024 },
  autoMinIntervalMs: { min: 1000, max: 3_600_000 },
  autoFileChangeThreshold: { min: 1, max: 10000 },
};

const CLEANUP_INTERVAL_OPTIONS = [
  { value: "1", labelKey: "hourly" },
  { value: "6", labelKey: "every6Hours" },
  { value: "12", labelKey: "every12Hours" },
  { value: "24", labelKey: "daily" },
  { value: "72", labelKey: "every3Days" },
  { value: "168", labelKey: "weekly" },
];

const HelpText = ({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) => (
  <p id={id} className="text-muted-foreground mt-1 text-xs leading-relaxed">
    {children}
  </p>
);

const FieldError = ({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) => (
  <p id={id} className="text-red mt-1 text-xs leading-relaxed">
    {children}
  </p>
);

interface CheckpointConfigData {
  maxCheckpoints: number;
  retentionDays: number;
  maxStorageBytes: number;
  maxFilesPerCheckpoint: number;
  maxFileSizeBytes: number;
  captureBinaryFiles: boolean;
  enableCompression: boolean;
  encryptAtRest: boolean;
  enableAutoCheckpoints: boolean;
  trackedExtensions: string[];
  autoCleanup: boolean;
  cleanupIntervalHours: number;
  autoEnabled: boolean;
  autoMinIntervalMs: number;
  autoFileChangeThreshold: number;
  autoShowNotifications: boolean;
}

const DEFAULT_CONFIG: CheckpointConfigData = {
  maxCheckpoints: 1000,
  retentionDays: 7,
  maxStorageBytes: 1000000000, // 1GB
  maxFilesPerCheckpoint: 10000,
  maxFileSizeBytes: 5242880, // 5MB per-file capture limit
  captureBinaryFiles: true,
  enableCompression: true,
  encryptAtRest: false,
  enableAutoCheckpoints: true, // matches knox.checkpoints.enableAutoCheckpoints default
  trackedExtensions: [
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "java",
    "cpp",
    "c",
    "cs",
    "go",
    "rs",
    "php",
    "rb",
    "swift",
    "kt",
    "html",
    "css",
    "scss",
    "json",
    "yaml",
    "yml",
    "md",
    "txt",
  ],
  autoCleanup: true,
  cleanupIntervalHours: 24,
  autoEnabled: true,
  autoMinIntervalMs: 60_000,
  autoFileChangeThreshold: 5,
  autoShowNotifications: false,
};

type ValidationErrors = Partial<Record<keyof CheckpointConfigData, string>>;

function parseStorageBytes(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!match) {
    return null;
  }

  const size = Number(match[1]);
  const unit = (match[2]?.toUpperCase() ?? "B") as keyof typeof STORAGE_UNITS;
  if (!Number.isFinite(size) || size <= 0 || !STORAGE_UNITS[unit]) {
    return null;
  }

  return Math.round(size * STORAGE_UNITS[unit]);
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

function parseExtensions(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((extension) => extension.trim().replace(/^\.+/, "").toLowerCase())
        .filter(Boolean),
    ),
  );
}

function toNumber(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeLoadedConfig(
  value: Partial<CheckpointConfigData> | null | undefined,
): CheckpointConfigData {
  return {
    maxCheckpoints: toNumber(
      value?.maxCheckpoints,
      DEFAULT_CONFIG.maxCheckpoints,
    ),
    retentionDays: toNumber(value?.retentionDays, DEFAULT_CONFIG.retentionDays),
    maxStorageBytes: toNumber(
      value?.maxStorageBytes,
      DEFAULT_CONFIG.maxStorageBytes,
    ),
    maxFilesPerCheckpoint: toNumber(
      value?.maxFilesPerCheckpoint,
      DEFAULT_CONFIG.maxFilesPerCheckpoint,
    ),
    maxFileSizeBytes: toNumber(
      value?.maxFileSizeBytes,
      DEFAULT_CONFIG.maxFileSizeBytes,
    ),
    captureBinaryFiles:
      typeof value?.captureBinaryFiles === "boolean"
        ? value.captureBinaryFiles
        : DEFAULT_CONFIG.captureBinaryFiles,
    enableCompression:
      typeof value?.enableCompression === "boolean"
        ? value.enableCompression
        : DEFAULT_CONFIG.enableCompression,
    encryptAtRest:
      typeof value?.encryptAtRest === "boolean"
        ? value.encryptAtRest
        : DEFAULT_CONFIG.encryptAtRest,
    enableAutoCheckpoints:
      typeof value?.enableAutoCheckpoints === "boolean"
        ? value.enableAutoCheckpoints
        : DEFAULT_CONFIG.enableAutoCheckpoints,
    trackedExtensions: Array.isArray(value?.trackedExtensions)
      ? value.trackedExtensions.map((extension) => String(extension))
      : DEFAULT_CONFIG.trackedExtensions,
    autoCleanup:
      typeof value?.autoCleanup === "boolean"
        ? value.autoCleanup
        : DEFAULT_CONFIG.autoCleanup,
    cleanupIntervalHours: toNumber(
      value?.cleanupIntervalHours,
      DEFAULT_CONFIG.cleanupIntervalHours,
    ),
    autoEnabled:
      typeof value?.autoEnabled === "boolean"
        ? value.autoEnabled
        : DEFAULT_CONFIG.autoEnabled,
    autoMinIntervalMs: toNumber(
      value?.autoMinIntervalMs,
      DEFAULT_CONFIG.autoMinIntervalMs,
    ),
    autoFileChangeThreshold: toNumber(
      value?.autoFileChangeThreshold,
      DEFAULT_CONFIG.autoFileChangeThreshold,
    ),
    autoShowNotifications:
      typeof value?.autoShowNotifications === "boolean"
        ? value.autoShowNotifications
        : DEFAULT_CONFIG.autoShowNotifications,
  };
}

function hasCheckpointConfigFields(
  value: unknown,
): value is Partial<CheckpointConfigData> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.keys(DEFAULT_CONFIG).some((key) => key in value);
}

function getNumberValue(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isWholeNumberInRange(
  value: number,
  min: number,
  max?: number,
): boolean {
  return (
    Number.isInteger(value) &&
    value >= min &&
    (max === undefined || value <= max)
  );
}

type ConfigSectionProps = {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
};

const ConfigSection = ({ icon, title, children }: ConfigSectionProps) => (
  <Card className="border-border/70 bg-card/70 overflow-hidden shadow-none">
    <CardHeader className="border-border/50 border-b px-3 py-2.5">
      <CardTitle className="flex min-w-0 items-center gap-2 text-sm leading-tight font-semibold">
        <span className="text-knoxcyan shrink-0">{icon}</span>
        <span className="min-w-0 truncate">{title}</span>
      </CardTitle>
    </CardHeader>
    <CardContent className="divide-border/50 divide-y px-3 py-0">
      {children}
    </CardContent>
  </Card>
);

type SettingRowProps = {
  children?: React.ReactNode;
  control: React.ReactNode;
  error?: string;
  help: React.ReactNode;
  htmlFor?: string;
  label: string;
};

const SettingRow = ({
  children,
  control,
  error,
  help,
  htmlFor,
  label,
}: SettingRowProps) => {
  const helpId = htmlFor ? `${htmlFor}-help` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_minmax(9rem,14rem)] md:items-start">
      <div className="min-w-0">
        <Label
          htmlFor={htmlFor}
          className="text-foreground text-sm leading-tight font-medium"
        >
          {label}
        </Label>
        <HelpText id={helpId}>{help}</HelpText>
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
      <div
        className="w-full md:justify-self-end"
        aria-describedby={cn(helpId, errorId)}
      >
        {control}
      </div>
      {children}
    </div>
  );
};

function getValidationErrors(
  config: CheckpointConfigData,
  maxStorageInput: string,
  maxFileSizeInput: string,
  t: (key: string) => string,
): ValidationErrors {
  const storageBytes = parseStorageBytes(maxStorageInput);
  const fileSizeBytes = parseStorageBytes(maxFileSizeInput);
  const errors: ValidationErrors = {};

  if (fileSizeBytes === null || fileSizeBytes < LIMITS.maxFileSizeBytes.min) {
    errors.maxFileSizeBytes = t("checkpointInvalidFileSize");
  }

  if (
    !isWholeNumberInRange(
      config.maxCheckpoints,
      LIMITS.maxCheckpoints.min,
      LIMITS.maxCheckpoints.max,
    )
  ) {
    errors.maxCheckpoints = t("checkpointInvalidMaxCheckpoints");
  }

  if (
    !isWholeNumberInRange(
      config.retentionDays,
      LIMITS.retentionDays.min,
      LIMITS.retentionDays.max,
    )
  ) {
    errors.retentionDays = t("checkpointInvalidRetentionDays");
  }

  if (storageBytes === null || storageBytes < LIMITS.maxStorageBytes.min) {
    errors.maxStorageBytes = t("checkpointInvalidStorageSize");
  }

  if (
    !isWholeNumberInRange(
      config.maxFilesPerCheckpoint,
      LIMITS.maxFilesPerCheckpoint.min,
      LIMITS.maxFilesPerCheckpoint.max,
    )
  ) {
    errors.maxFilesPerCheckpoint = t("checkpointInvalidMaxFiles");
  }

  if (
    !isWholeNumberInRange(
      config.autoMinIntervalMs,
      LIMITS.autoMinIntervalMs.min,
      LIMITS.autoMinIntervalMs.max,
    )
  ) {
    errors.autoMinIntervalMs = t("checkpointInvalidAutoInterval");
  }

  if (
    !isWholeNumberInRange(
      config.autoFileChangeThreshold,
      LIMITS.autoFileChangeThreshold.min,
      LIMITS.autoFileChangeThreshold.max,
    )
  ) {
    errors.autoFileChangeThreshold = t("checkpointInvalidAutoFileThreshold");
  }

  return errors;
}

export function CheckpointConfig() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [config, setConfig] = useState<CheckpointConfigData>(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] =
    useState<CheckpointConfigData>(DEFAULT_CONFIG);
  const [maxStorageInput, setMaxStorageInput] = useState(
    formatBytes(DEFAULT_CONFIG.maxStorageBytes),
  );
  const [maxFileSizeInput, setMaxFileSizeInput] = useState(
    formatBytes(DEFAULT_CONFIG.maxFileSizeBytes),
  );
  const [trackedExtensionsInput, setTrackedExtensionsInput] = useState(
    DEFAULT_CONFIG.trackedExtensions.join(", "),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const validationErrors = useMemo(
    () => getValidationErrors(config, maxStorageInput, maxFileSizeInput, t),
    [config, maxStorageInput, maxFileSizeInput, t],
  );
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const hasChanges = useMemo(() => {
    const parsedStorageBytes = parseStorageBytes(maxStorageInput);
    return (
      JSON.stringify(config) !== JSON.stringify(originalConfig) ||
      (parsedStorageBytes === null &&
        maxStorageInput.trim() !== formatBytes(originalConfig.maxStorageBytes))
    );
  }, [config, maxStorageInput, originalConfig]);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setIsLoading(true);
      const response = await ideMessenger.request(
        "getCheckpointConfig",
        undefined,
      );
      const content =
        response.status === "success" ? (response.content as any) : undefined;
      const responseConfig =
        content?.config ??
        (hasCheckpointConfigFields(content) ? content : null);

      if (response.status === "success" && responseConfig) {
        const loadedConfig = normalizeLoadedConfig(responseConfig);
        setConfig(loadedConfig);
        setOriginalConfig(loadedConfig);
        setMaxStorageInput(formatBytes(loadedConfig.maxStorageBytes));
        setMaxFileSizeInput(formatBytes(loadedConfig.maxFileSizeBytes));
        setTrackedExtensionsInput(loadedConfig.trackedExtensions.join(", "));
      }
    } catch (error) {
      console.warn("Could not load checkpoint config, using defaults:", error);
      setStatusMessage({
        type: "info",
        message: t("checkpointUseDefaultConfig"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveConfig = async () => {
    if (hasValidationErrors) {
      setStatusMessage({
        type: "error",
        message: t("checkpointFixValidationErrors"),
      });
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage(null);
      const normalizedConfig = normalizeLoadedConfig({
        ...config,
        trackedExtensions: parseExtensions(trackedExtensionsInput),
      });

      const response = await ideMessenger.request("saveCheckpointConfig", {
        config: normalizedConfig,
      });
      if (response.status === "success") {
        setConfig(normalizedConfig);
        setOriginalConfig({ ...normalizedConfig });
        setMaxStorageInput(formatBytes(normalizedConfig.maxStorageBytes));
        setMaxFileSizeInput(formatBytes(normalizedConfig.maxFileSizeBytes));
        setTrackedExtensionsInput(
          normalizedConfig.trackedExtensions.join(", "),
        );
        setStatusMessage({
          type: "success",
          message: t("checkpointConfigSaved"),
        });

        // Clear success message after 3 seconds
        setTimeout(() => setStatusMessage(null), 3000);
      } else {
        throw new Error(t("checkpointSaveFailed"));
      }
    } catch (error) {
      setStatusMessage({
        type: "error",
        message: `${t("checkpointSaveFailed")}: ${error instanceof Error ? error.message : t("unknownError")}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetConfig = () => {
    setConfig({ ...originalConfig });
    setMaxStorageInput(formatBytes(originalConfig.maxStorageBytes));
    setMaxFileSizeInput(formatBytes(originalConfig.maxFileSizeBytes));
    setTrackedExtensionsInput(originalConfig.trackedExtensions.join(", "));
    setStatusMessage(null);
  };

  const restoreDefaults = () => {
    setConfig({ ...DEFAULT_CONFIG });
    setMaxStorageInput(formatBytes(DEFAULT_CONFIG.maxStorageBytes));
    setMaxFileSizeInput(formatBytes(DEFAULT_CONFIG.maxFileSizeBytes));
    setTrackedExtensionsInput(DEFAULT_CONFIG.trackedExtensions.join(", "));
    setStatusMessage({
      type: "info",
      message: t("checkpointResetToDefault"),
    });
  };

  const handleStorageBytesChange = (value: string) => {
    setMaxStorageInput(value);
    const bytes = parseStorageBytes(value);
    if (bytes !== null) {
      setConfig((prev) => ({ ...prev, maxStorageBytes: bytes }));
    }
  };

  const normalizeStorageInput = () => {
    const bytes = parseStorageBytes(maxStorageInput);
    if (bytes !== null && bytes >= LIMITS.maxStorageBytes.min) {
      setMaxStorageInput(formatBytes(bytes));
    }
  };

  const handleFileSizeChange = (value: string) => {
    setMaxFileSizeInput(value);
    const bytes = parseStorageBytes(value);
    if (bytes !== null) {
      setConfig((prev) => ({ ...prev, maxFileSizeBytes: bytes }));
    }
  };

  const normalizeFileSizeInput = () => {
    const bytes = parseStorageBytes(maxFileSizeInput);
    if (bytes !== null && bytes >= LIMITS.maxFileSizeBytes.min) {
      setMaxFileSizeInput(formatBytes(bytes));
    }
  };

  const handleExtensionsChange = (value: string) => {
    setTrackedExtensionsInput(value);
    const extensions = parseExtensions(value);
    setConfig((prev) => ({ ...prev, trackedExtensions: extensions }));
  };

  return (
    <div className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Settings className="text-knoxcyan size-4 shrink-0" />
          <h1 className="text-foreground min-w-0 truncate text-sm font-semibold">
            {t("checkpointConfiguration")}
          </h1>
          {hasChanges && (
            <Badge
              variant="secondary"
              className="border-yellow/40 bg-yellow/10 text-yellow shrink-0 text-[11px]"
            >
              {t("unsavedChanges")}
            </Badge>
          )}
        </div>
      </div>

      {statusMessage && (
        <Alert
          className={cn(
            "border-border bg-vsc-input-background rounded-md px-3 py-2",
            statusMessage.type === "success" && "border-green/40",
            statusMessage.type === "error" && "border-red/40",
            statusMessage.type === "info" && "border-blue/40",
          )}
        >
          {statusMessage.type === "success" && (
            <CheckCircle className="text-green h-4 w-4" />
          )}
          {statusMessage.type === "error" && (
            <AlertCircle className="text-red h-4 w-4" />
          )}
          {statusMessage.type === "info" && (
            <Info className="text-blue h-4 w-4" />
          )}
          <AlertDescription
            className={cn(
              "text-xs leading-relaxed",
              statusMessage.type === "success" && "text-green",
              statusMessage.type === "error" && "text-red",
              statusMessage.type === "info" && "text-blue",
            )}
          >
            {statusMessage.message}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2" data-testid="checkpoint-config-sections">
        <ConfigSection
          icon={<HardDrive className="size-4" />}
          title={t("storageLimits")}
        >
          <SettingRow
            htmlFor="maxCheckpoints"
            label={t("maxCheckpoints")}
            help={t("checkpointMaxHelp")}
            error={validationErrors.maxCheckpoints}
            control={
              <Input
                id="maxCheckpoints"
                type="number"
                min="1"
                max="10000"
                value={config.maxCheckpoints}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    maxCheckpoints: getNumberValue(
                      e.target.value,
                      LIMITS.maxCheckpoints.min,
                    ),
                  }))
                }
                disabled={isLoading}
                aria-invalid={Boolean(validationErrors.maxCheckpoints)}
                className="h-8 text-sm"
              />
            }
          />

          <SettingRow
            htmlFor="retentionDays"
            label={t("retentionPeriodDays")}
            help={t("checkpointRetentionHelp")}
            error={validationErrors.retentionDays}
            control={
              <Input
                id="retentionDays"
                type="number"
                min="1"
                max="365"
                value={config.retentionDays}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    retentionDays: getNumberValue(
                      e.target.value,
                      LIMITS.retentionDays.min,
                    ),
                  }))
                }
                disabled={isLoading}
                aria-invalid={Boolean(validationErrors.retentionDays)}
                className="h-8 text-sm"
              />
            }
          />

          <SettingRow
            htmlFor="maxStorage"
            label={t("maxStorageSize")}
            help={t("checkpointStorageHelp")}
            error={validationErrors.maxStorageBytes}
            control={
              <Input
                id="maxStorage"
                type="text"
                value={maxStorageInput}
                onBlur={normalizeStorageInput}
                onChange={(e) => handleStorageBytesChange(e.target.value)}
                disabled={isLoading}
                placeholder="1 GB"
                aria-invalid={Boolean(validationErrors.maxStorageBytes)}
                className="h-8 text-sm"
              />
            }
          />
        </ConfigSection>

        <ConfigSection
          icon={<Clock className="size-4" />}
          title={t("checkpointAutomation")}
        >
          <SettingRow
            htmlFor="enableAutoCheckpoints"
            label={t("enableAutoCheckpoints")}
            help={t("checkpointAutoCheckpointsHelp")}
            control={
              <div className="flex md:justify-end">
                <Switch
                  id="enableAutoCheckpoints"
                  aria-label={t("enableAutoCheckpoints")}
                  checked={config.enableAutoCheckpoints}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      enableAutoCheckpoints: checked,
                    }))
                  }
                  disabled={isLoading}
                />
              </div>
            }
          />

          <SettingRow
            htmlFor="autoEnabled"
            label={t("enableTimedAutoCheckpoints")}
            help={t("checkpointTimedAutoHelp")}
            control={
              <div className="flex md:justify-end">
                <Switch
                  id="autoEnabled"
                  aria-label={t("enableTimedAutoCheckpoints")}
                  checked={config.autoEnabled}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({ ...prev, autoEnabled: checked }))
                  }
                  disabled={isLoading}
                />
              </div>
            }
          />

          {config.autoEnabled && (
            <>
              <SettingRow
                htmlFor="autoMinInterval"
                label={t("autoMinIntervalSeconds")}
                help={t("checkpointAutoIntervalHelp")}
                error={validationErrors.autoMinIntervalMs}
                control={
                  <Input
                    id="autoMinInterval"
                    type="number"
                    min={LIMITS.autoMinIntervalMs.min / 1000}
                    max={LIMITS.autoMinIntervalMs.max / 1000}
                    value={Math.round(config.autoMinIntervalMs / 1000)}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        autoMinIntervalMs: getNumberValue(
                          e.target.value,
                          LIMITS.autoMinIntervalMs.min / 1000,
                        ) * 1000,
                      }))
                    }
                    disabled={isLoading}
                    aria-invalid={Boolean(validationErrors.autoMinIntervalMs)}
                    className="h-8 text-sm"
                  />
                }
              />
              <SettingRow
                htmlFor="autoFileChangeThreshold"
                label={t("autoFileChangeThreshold")}
                help={t("checkpointAutoFileThresholdHelp")}
                error={validationErrors.autoFileChangeThreshold}
                control={
                  <Input
                    id="autoFileChangeThreshold"
                    type="number"
                    min={LIMITS.autoFileChangeThreshold.min}
                    max={LIMITS.autoFileChangeThreshold.max}
                    value={config.autoFileChangeThreshold}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        autoFileChangeThreshold: getNumberValue(
                          e.target.value,
                          LIMITS.autoFileChangeThreshold.min,
                        ),
                      }))
                    }
                    disabled={isLoading}
                    aria-invalid={Boolean(validationErrors.autoFileChangeThreshold)}
                    className="h-8 text-sm"
                  />
                }
              />
              <SettingRow
                htmlFor="autoShowNotifications"
                label={t("autoShowNotifications")}
                help={t("checkpointAutoNotifyHelp")}
                control={
                  <div className="flex md:justify-end">
                    <Switch
                      id="autoShowNotifications"
                      aria-label={t("autoShowNotifications")}
                      checked={config.autoShowNotifications}
                      onCheckedChange={(checked) =>
                        setConfig((prev) => ({
                          ...prev,
                          autoShowNotifications: checked,
                        }))
                      }
                      disabled={isLoading}
                    />
                  </div>
                }
              />
            </>
          )}

          <SettingRow
            htmlFor="autoCleanup"
            label={t("autoCleanup")}
            help={t("checkpointAutoCleanupHelp")}
            control={
              <div className="flex md:justify-end">
                <Switch
                  id="autoCleanup"
                  aria-label={t("autoCleanup")}
                  checked={config.autoCleanup}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({ ...prev, autoCleanup: checked }))
                  }
                  disabled={isLoading}
                />
              </div>
            }
          />

          {config.autoCleanup && (
            <SettingRow
              htmlFor="cleanupInterval"
              label={t("cleanupInterval")}
              help={t("checkpointCleanupIntervalHelp")}
              control={
                <Select
                  value={config.cleanupIntervalHours.toString()}
                  onValueChange={(value) =>
                    setConfig((prev) => ({
                      ...prev,
                      cleanupIntervalHours: Number.parseInt(value, 10),
                    }))
                  }
                  disabled={isLoading}
                >
                  <SelectTrigger
                    id="cleanupInterval"
                    aria-label={t("cleanupInterval")}
                    className="h-8 text-sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLEANUP_INTERVAL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          )}
        </ConfigSection>

        <ConfigSection
          icon={<Zap className="size-4" />}
          title={t("performanceSettings")}
        >
          <SettingRow
            htmlFor="maxFiles"
            label={t("maxFilesPerCheckpoint")}
            help={t("checkpointMaxFilesHelp")}
            error={validationErrors.maxFilesPerCheckpoint}
            control={
              <Input
                id="maxFiles"
                type="number"
                min="1"
                max="100000"
                value={config.maxFilesPerCheckpoint}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    maxFilesPerCheckpoint: getNumberValue(
                      e.target.value,
                      LIMITS.maxFilesPerCheckpoint.min,
                    ),
                  }))
                }
                disabled={isLoading}
                aria-invalid={Boolean(validationErrors.maxFilesPerCheckpoint)}
                className="h-8 text-sm"
              />
            }
          />

          <SettingRow
            htmlFor="maxFileSize"
            label={t("maxFileSize")}
            help={t("checkpointMaxFileSizeHelp")}
            error={validationErrors.maxFileSizeBytes}
            control={
              <Input
                id="maxFileSize"
                type="text"
                value={maxFileSizeInput}
                onBlur={normalizeFileSizeInput}
                onChange={(e) => handleFileSizeChange(e.target.value)}
                disabled={isLoading}
                placeholder="5 MB"
                aria-invalid={Boolean(validationErrors.maxFileSizeBytes)}
                className="h-8 text-sm"
              />
            }
          />

          <SettingRow
            htmlFor="enableCompression"
            label={t("enableCompression")}
            help={t("checkpointCompressionHelp")}
            control={
              <div className="flex md:justify-end">
                <Switch
                  id="enableCompression"
                  aria-label={t("enableCompression")}
                  checked={config.enableCompression}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      enableCompression: checked,
                    }))
                  }
                  disabled={isLoading}
                />
              </div>
            }
          />

          <SettingRow
            htmlFor="encryptAtRest"
            label={t("encryptAtRest")}
            help={t("checkpointEncryptAtRestHelp")}
            control={
              <div className="flex md:justify-end">
                <Switch
                  id="encryptAtRest"
                  aria-label={t("encryptAtRest")}
                  checked={config.encryptAtRest}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      encryptAtRest: checked,
                    }))
                  }
                  disabled={isLoading}
                />
              </div>
            }
          />
        </ConfigSection>

        <ConfigSection
          icon={<FileText className="size-4" />}
          title={t("fileTracking")}
        >
          <SettingRow
            htmlFor="trackedExtensions"
            label={t("trackedFileExtensions")}
            help={t("checkpointTrackedExtensionsHelp")}
            control={
              <Input
                id="trackedExtensions"
                type="text"
                value={trackedExtensionsInput}
                onBlur={() =>
                  setTrackedExtensionsInput(
                    parseExtensions(trackedExtensionsInput).join(", "),
                  )
                }
                onChange={(e) => handleExtensionsChange(e.target.value)}
                disabled={isLoading}
                placeholder={t("fileExtensionsPlaceholder")}
                className="h-8 text-sm"
              />
            }
          />

          <SettingRow
            htmlFor="captureBinaryFiles"
            label={t("captureBinaryFiles")}
            help={t("checkpointCaptureBinaryHelp")}
            control={
              <div className="flex md:justify-end">
                <Switch
                  id="captureBinaryFiles"
                  aria-label={t("captureBinaryFiles")}
                  checked={config.captureBinaryFiles}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      captureBinaryFiles: checked,
                    }))
                  }
                  disabled={isLoading}
                />
              </div>
            }
          />
        </ConfigSection>
      </div>

      <div className="border-border/40 grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-3">
        <Button
          variant="outline"
          onClick={restoreDefaults}
          disabled={isLoading}
          className="h-8 gap-1.5 px-2 text-xs"
        >
          <Clock className="size-4" />
          {t("reset")}
        </Button>

        <Button
          variant="outline"
          onClick={resetConfig}
          disabled={isLoading || !hasChanges}
          className="h-8 gap-1.5 px-2 text-xs"
        >
          <X className="size-4" />
          {t("cancel")}
        </Button>

        <Button
          onClick={saveConfig}
          disabled={isLoading || !hasChanges || hasValidationErrors}
          className="h-8 gap-1.5 px-2 text-xs"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t("saving")}
            </>
          ) : (
            <>
              <Save className="size-4" />
              {t("save")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
