import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle, Loader2, Pause, XCircle } from "lucide-react";

export type VerificationState = "idle" | "running" | "passed" | "failed" | "bailed";

interface VerificationStatusProps {
  state: VerificationState;
  filePath?: string;
  iteration?: number;
  maxIterations?: number;
  fixedCount?: number;
  remainingCount?: number;
}

const STATE_CONFIG: Record<
  VerificationState,
  { icon: React.ReactNode; label: string; className: string }
> = {
  idle: { icon: <Pause size={14} />, label: "verificationIdle", className: "text-gray-400" },
  running: { icon: <Loader2 size={14} className="animate-spin" />, label: "verificationRunning", className: "text-blue-400" },
  passed: { icon: <CheckCircle size={14} />, label: "verificationPassed", className: "text-green-400" },
  failed: { icon: <XCircle size={14} />, label: "verificationFailed", className: "text-red-400" },
  bailed: { icon: <AlertTriangle size={14} />, label: "verificationBailed", className: "text-yellow-400" },
};

export function VerificationStatus({
  state,
  filePath,
  iteration,
  maxIterations,
  fixedCount,
  remainingCount,
}: VerificationStatusProps) {
  const { t } = useTranslation();
  const config = STATE_CONFIG[state];

  if (state === "idle") return null;

  const fileName = filePath?.split("/").pop() ?? "";

  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${config.className}`}
      style={{ backgroundColor: "var(--vscode-editor-background)", border: "1px solid var(--vscode-panel-border)" }}
    >
      <span className="text-sm">{config.icon}</span>
      <span className="font-medium">{t(config.label)}</span>

      {fileName && (
        <span className="truncate max-w-30 opacity-70" title={filePath}>
          {fileName}
        </span>
      )}

      {state === "running" && iteration !== undefined && maxIterations !== undefined && (
        <span className="opacity-60">
          ({iteration}/{maxIterations})
        </span>
      )}

      {(state === "passed" || state === "failed" || state === "bailed") && (
        <span className="opacity-60">
          {fixedCount !== undefined && fixedCount > 0 && (
            <span className="text-green-300 mr-1">+{fixedCount} {t("fixed")}</span>
          )}
          {remainingCount !== undefined && remainingCount > 0 && (
            <span className="text-red-300">{remainingCount} {t("remaining")}</span>
          )}
        </span>
      )}
    </div>
  );
}

interface VerificationStatusListProps {
  verifications: VerificationStatusProps[];
}

export function VerificationStatusList({ verifications }: VerificationStatusListProps) {
  if (verifications.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 mt-1">
      {verifications.map((v, i) => (
        <VerificationStatus key={`${v.filePath}-${i}`} {...v} />
      ))}
    </div>
  );
}
