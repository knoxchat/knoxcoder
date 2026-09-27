import { ChatHistoryItem, ChatMessage, MessagePart } from "../";
import { normalizeToMessageParts } from "../util/messageContent";
import { extractTextToolCalls, looksLikeTextToolCall } from "./parseTextToolCalls";
import { formatPlanInject, formatPlanInjectFromHistory } from "../tools/planStore";
import { formatCodebaseCardInject } from "../context/codebaseCard";
import { formatRustPolicyInject } from "../context/rustPolicy";
import { formatSerialContextInject } from "../context/serialContext";

/**
 * Chat history → model messages.
 *
 * Merge order with the rest of the stack (see `core/config/rules.ts`):
 * 1) This DEFAULT_SYSTEM_MESSAGE
 * 2) GUI per-turn inject (memory) merged into the leading system msg
 * 3) Config / `.knoxrules` via `LLM.systemMessage` in `compileChatMessages`
 * 4) Optional suggested-skills hint in `llmStreamChat`
 * 5) Slash prompt `<system>` only when that command runs
 */

const DEFAULT_SYSTEM_MESSAGE = `<important_rules>
  Always include the language and file name in the info string when you write code blocks. If you are editing "src/main.py" for example, your code block should start with '\`\`\`python src/main.py'.

  File edits — use tools, never the terminal:
  - Call tools by their catalog names (builtin_read_file, not read_file or read_file_line).
  - Partial reads: builtin_read_file with filepath + optional startLine/endLine (1-based). There is no read_file_line tool.
  - Search with builtin_exact_search (ripgrep -F literal). Paste code as-is; () . * | are not regex unless pcre2=true. Prefer path (e.g. mm/) and fileType (c, asm, kconfig) on large trees. Truncated results say to pass maxResults/path/fileType. Not grep/rg/read_file_line.
  - Paths are workspace-relative (src/main.rs). Do not invent tool names from the action.
  - Read a file before editing it.
  - Prefer builtin_edit_file (exact old_string → new_string) for targeted changes. old_string must uniquely match unless replace_all is true.
  - Use builtin_apply_patch for multi-hunk or multi-file edits in one atomic call (Codex-style *** Begin Patch).
  - Use builtin_write_file only for a full-file create or rewrite.
  - Use builtin_create_new_file only when the file must not already exist.
  - Do not write or patch files with cat, echo, heredoc, sed, or similar shell commands.
  - composite_smart_edit is optional/legacy; prefer the edit/write tools above.
  - Long-running shell (tests, servers): set background=true on builtin_run_terminal_command, or wait — after ~30s it backgrounds and returns a job_id. make/ninja/cmake --build/meson compile/./configure/qemu-system-*/cargo check|build|test|clippy|nextest|bench|doc|miri background immediately. Do not background cargo metadata, cargo tree, or cargo fmt --check. Poll / wait / kill with builtin_await_shell (default 10 min per call; jobs survive the LLM turn). Optional tail_lines, grep, since_byte, errors_only. make/ninja/gcc/qemu/cargo check|test|clippy results are compacted to parsed errors plus a short tail (full log path is in the tool result). Do not pipe builds/tests to grep to filter errors — grep's no-match exit 1 looks like a failed job.
  - Interactive programs (QEMU serial, gdb, kgdb, menuconfig): builtin_pty_start, then builtin_pty_send / builtin_pty_read. Timeout is per-read, not process lifetime. Ctrl-C is \\x03 or ctrl_c=true. Prefer builtin_qemu to start qemu-system-* (kernel/initrd, serial stdio, optional gdb -s -S); serial is the job log. Use builtin_debug (DAP) when a debug session exists. Read CONFIG_* with builtin_kconfig (do not dump .config). Who owns a file: builtin_maintainers lookup path=mm/filemap.c (do not dump MAINTAINERS). Parallel explore: builtin_task explores=[{prompt, path}, ...] (cap 3).
  - Prefer builtin_git_status / builtin_git_diff / builtin_git_log / builtin_git_blame / builtin_git_commit / builtin_git_bisect over shell git. Pickaxe: builtin_git_log with search (-S) or regex (-G). Do not push or force via tools. Always builtin_git_bisect reset when done or aborting.
  - Use builtin_workspace_checkpoint to list/create/restore file snapshots. restore always asks the user. Memory snapshots stay on builtin_memory_manage.
  - Keep a durable checklist with builtin_plan (create/update/complete). set_current when you start a step; complete as soon as that step is finished. It is re-injected every turn and survives compaction — do not rely on assistant prose for a multi-hour kernel plan.
  - For a bounded parallel unit of work, spawn builtin_task (explore | review | general). The child is isolated; you only get a summary.
  - If a choice would change edits, call builtin_ask_user instead of guessing.
  - Use the native tool/function-call interface. Never print DSML, XML invoke, or tool_calls markup.
</important_rules>`;

const CANCELED_TOOL_CALL_MESSAGE =
  "This tool call was cancelled by the user. You should clarify next steps, as they don't wish for you to use this tool.";

function historyToolStates(item: ChatHistoryItem) {
  if (item.toolCallStates?.length) {
    return item.toolCallStates;
  }
  return item.toolCallState ? [item.toolCallState] : [];
}

function isFullyCanceledToolTurn(item: ChatHistoryItem): boolean {
  const states = historyToolStates(item);
  return states.length > 0 && states.every((state) => state.status === "canceled");
}

function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
  }
  return "";
}

/** Strip leaked DSML/XML tool markup so it is not replayed to the model. */
function sanitizeAssistantMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant") {
    return message;
  }
  const text = messageText(message);
  if (!looksLikeTextToolCall(text)) {
    return message;
  }
  const { content } = extractTextToolCalls(text);
  if (content === text) {
    return message;
  }
  return {
    ...message,
    content,
  };
}

export function constructMessages(
  history: ChatHistoryItem[],
  sessionId?: string | null,
): ChatMessage[] {
  const filteredHistory = history.filter(
    (item) => item.message.role !== "system",
  );
  const msgs: ChatMessage[] = [];

  msgs.push({
    role: "system",
    content: DEFAULT_SYSTEM_MESSAGE,
  });

  const plan =
    formatPlanInject(sessionId) || formatPlanInjectFromHistory(filteredHistory);
  if (plan) {
    msgs.push({
      role: "system",
      content: plan,
    });
  }

  const codebaseCard = formatCodebaseCardInject();
  if (codebaseCard) {
    msgs.push({
      role: "system",
      content: codebaseCard,
    });
  }

  const rustPolicy = formatRustPolicyInject();
  if (rustPolicy) {
    msgs.push({
      role: "system",
      content: rustPolicy,
    });
  }

  const serial = formatSerialContextInject();
  if (serial) {
    msgs.push({
      role: "system",
      content: serial,
    });
  }

  for (let i = 0; i < filteredHistory.length; i++) {
    const historyItem = filteredHistory[i];

    if (historyItem.message.role === "user") {
      // Gather context items for user messages
      let content = normalizeToMessageParts(historyItem.message);

      const ctxItems = historyItem.contextItems.map((ctxItem) => {
        return { type: "text", text: `${ctxItem.content}\n` } as MessagePart;
      });

      content = [...ctxItems, ...content];
      msgs.push({
        ...historyItem.message,
        content,
      });
    } else if (isFullyCanceledToolTurn(historyItem)) {
      // Entire assistant tool turn was canceled (walk toolCallStates, not only primary).
      msgs.push({
        ...historyItem.message,
        content: CANCELED_TOOL_CALL_MESSAGE,
      });
    } else {
      msgs.push(sanitizeAssistantMessage(historyItem.message));
    }
  }

  // Remove the "id" from all of the messages
  return msgs.map((msg) => {
    const { id, ...rest } = msg as any;
    return rest;
  });
}
