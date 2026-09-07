import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FlaskConical, Hammer, Package, Zap } from "lucide-react";

export interface TerminalSuggestionData {
  id: string;
  message: string;
  category: "build" | "test" | "runtime" | "dependency" | "general";
  severity: "error" | "warning";
  confidence: number;
  actionLabel: string;
}

interface TerminalSuggestionProps {
  suggestion: TerminalSuggestionData;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  build: <Hammer size={16} />,
  test: <FlaskConical size={16} />,
  runtime: <Zap size={16} />,
  dependency: <Package size={16} />,
  general: <AlertTriangle size={16} />,
};

const SEVERITY_COLORS: Record<string, string> = {
  error: "border-l-red-400",
  warning: "border-l-yellow-400",
};

export function TerminalSuggestion({
  suggestion,
  onAccept,
  onDismiss,
}: TerminalSuggestionProps) {
  const { t } = useTranslation();
  const icon = CATEGORY_ICONS[suggestion.category] || <AlertTriangle size={16} />;
  const borderColor = SEVERITY_COLORS[suggestion.severity] || "";

  return (
    <div
      className={`flex items-start gap-2 rounded border-l-2 px-3 py-2 ${borderColor}`}
      style={{
        backgroundColor: "var(--vscode-notifications-background)",
        borderColor: "var(--vscode-panel-border)",
      }}
    >
      <span className="text-base mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-tight">{suggestion.message}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <button
            onClick={() => onAccept(suggestion.id)}
            className="text-xs px-2.5 py-0.5 rounded font-medium"
            style={{
              backgroundColor: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
            }}
          >
            {suggestion.actionLabel || t("fixThis")}
          </button>
          <button
            onClick={() => onDismiss(suggestion.id)}
            className="text-xs px-2 py-0.5 rounded opacity-60 hover:opacity-100"
            style={{
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
            }}
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TerminalSuggestionListProps {
  suggestions: TerminalSuggestionData[];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissAll?: () => void;
}

export function TerminalSuggestionList({
  suggestions,
  onAccept,
  onDismiss,
  onDismissAll,
}: TerminalSuggestionListProps) {
  const { t } = useTranslation();

  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium opacity-60">
          {t("terminalSuggestions")} ({suggestions.length})
        </span>
        {onDismissAll && suggestions.length > 1 && (
          <button
            onClick={onDismissAll}
            className="text-xs opacity-40 hover:opacity-100"
          >
            {t("dismissAll")}
          </button>
        )}
      </div>
      {suggestions.map((suggestion) => (
        <TerminalSuggestion
          key={suggestion.id}
          suggestion={suggestion}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
