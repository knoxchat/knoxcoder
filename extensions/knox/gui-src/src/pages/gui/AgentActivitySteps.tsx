import {
  Bot,
  Check,
  FilePenLine,
  FileText,
  GitBranch,
  MessageCircleQuestion,
  MessageSquare,
  Search,
  Sparkles,
  Terminal,
  TestTube,
  Wrench,
  X,
} from "lucide-react";
import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { lightGray } from "../../components";
import Spinner from "../../components/gui/Spinner";
import { LoadingVariant } from "../../components/loaders/LoadingState";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import {
  activityAnchorId,
  AgentActivityKind,
  AgentActivityStatus,
  AgentActivityStep,
} from "../../redux/util/agentActivity";
import { requestWorkspaceRestore } from "../../redux/util/recordSoulEvent";

const KIND_ICON: Record<AgentActivityKind, typeof FileText> = {
  thinking: Sparkles,
  read: FileText,
  search: Search,
  edit: FilePenLine,
  test: TestTube,
  shell: Terminal,
  git: GitBranch,
  task: Bot,
  ask: MessageCircleQuestion,
  reply: MessageSquare,
  other: Wrench,
};

export function loadingVariantFor(kind?: AgentActivityKind): LoadingVariant {
  switch (kind) {
    case "thinking":
    case "reply":
      return "orbit";
    case "read":
    case "search":
      return "dots";
    default:
      return "drive";
  }
}

export function kindLabelKey(kind: AgentActivityKind): string {
  switch (kind) {
    case "thinking":
      return "activityKindThinking";
    case "read":
      return "activityKindRead";
    case "search":
      return "activityKindSearch";
    case "edit":
      return "activityKindEdit";
    case "test":
      return "activityKindTest";
    case "shell":
      return "activityKindShell";
    case "git":
      return "activityKindGit";
    case "task":
      return "activityKindTask";
    case "ask":
      return "activityKindAsk";
    case "reply":
      return "activityKindReply";
    default:
      return "activityKindOther";
  }
}

function StatusGlyph({ status }: { status: AgentActivityStatus }) {
  if (status === "running") {
    return <Spinner />;
  }
  if (status === "done") {
    return <Check className="h-3 w-3 text-knoxcyan" />;
  }
  if (status === "canceled") {
    return <X className="h-3 w-3 text-orange" />;
  }
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ backgroundColor: lightGray }}
    />
  );
}

function scrollToStep(step: AgentActivityStep) {
  const el = document.getElementById(activityAnchorId(step.id));
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function AgentActivityStepList({
  steps,
}: {
  steps: AgentActivityStep[];
}) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);

  if (!steps.length) {
    return null;
  }

  return (
    <ol
      className="m-0 flex list-none flex-col gap-0.5 p-0"
      data-testid="agent-activity-step-list"
    >
      {steps.map((step) => {
        const Icon = KIND_ICON[step.kind];
        return (
          <li key={step.id} className="flex items-center gap-1.5">
            <button
              type="button"
              className="hover:bg-lightgray/10 flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent px-0 py-0.5 text-left"
              onClick={() => scrollToStep(step)}
              title={t(kindLabelKey(step.kind))}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <StatusGlyph status={step.status} />
              </span>
              <Icon className="text-secgray h-3 w-3 shrink-0" />
              <span className="text-vsc-foreground shrink-0">
                {t(kindLabelKey(step.kind))}
              </span>
              {step.detail ? (
                <code className="text-secgray min-w-0 truncate">
                  {step.detail}
                </code>
              ) : null}
            </button>
            {step.workspaceCheckpointId ? (
              <button
                type="button"
                className="text-knoxcyan hover:underline shrink-0 cursor-pointer border-none bg-transparent px-0 py-0.5 font-mono"
                title={t("activityCheckpointRestore", {
                  id: step.workspaceCheckpointId,
                })}
                onClick={(event) => {
                  void requestWorkspaceRestore(
                    ideMessenger,
                    step.workspaceCheckpointId!,
                    { rewindMemory: event.shiftKey },
                  );
                }}
              >
                cp {step.workspaceCheckpointId.slice(0, 8)}
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
