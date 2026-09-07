import React, { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  FileText,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";

interface BrainSessionRow {
  id: string;
  title: string;
  workspace_directory: string;
  project_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  summary: string | null;
  is_active: boolean;
}

interface EpisodicRow {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

interface SemanticRow {
  id: number;
  category: string;
  title: string;
  content: string;
  importance_score: number;
}

interface TopicRow {
  topic: string;
  keywords: string;
  confidence: number;
}

interface SessionHistoryData {
  session: BrainSessionRow | null;
  episodic: EpisodicRow[];
  semantic: SemanticRow[];
  topics: TopicRow[];
  token_estimate: number;
  message_count: number;
}

interface BacklogMatch {
  id: number;
  session_id?: string;
  source_session_id?: string;
  role?: string;
  category?: string;
  title?: string;
  content: string;
  kind: "episodic" | "semantic";
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MemorySessionHistory() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);

  const [sessions, setSessions] = useState<BrainSessionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<SessionHistoryData | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [backlogMatches, setBacklogMatches] = useState<BacklogMatch[]>([]);
  const [searchingBacklog, setSearchingBacklog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const result = await ideMessenger.request("brain/listSessions", { limit: 100 });
      if (result.status === "success") {
        const content = result.content as BrainSessionRow[] | { sessions?: BrainSessionRow[] };
        const rows = Array.isArray(content)
          ? content
          : Array.isArray(content?.sessions)
            ? content.sessions
            : [];
        setSessions(rows);
      }
    } catch {
      setError(t("memorySessionHistoryLoadError"));
    } finally {
      setLoadingList(false);
    }
  }, [ideMessenger, t]);

  const loadHistory = useCallback(
    async (sessionId: string) => {
      setLoadingHistory(true);
      setError(null);
      try {
        const result = await ideMessenger.request("brain/getSessionHistory", {
          sessionId,
          episodicLimit: 200,
          semanticLimit: 100,
        });
        if (result.status === "success") {
          setHistory(result.content as SessionHistoryData);
        }
      } catch {
        setError(t("memorySessionHistoryLoadError"));
      } finally {
        setLoadingHistory(false);
      }
    },
    [ideMessenger, t],
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedId) {
      void loadHistory(selectedId);
    } else {
      setHistory(null);
    }
  }, [selectedId, loadHistory]);

  // Cross-session backlog search (IMP-22)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setBacklogMatches([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingBacklog(true);
      try {
        const result = await ideMessenger.request("brain/searchBacklogs", {
          query: q,
          limit: 30,
          workspace_dir: window.workspacePaths?.[0] ?? "",
        });
        if (result.status === "success") {
          const data = result.content as {
            result?: {
              episodic?: Array<{
                id: number;
                session_id: string;
                role: string;
                content: string;
              }>;
              semantic?: Array<{
                id: number;
                source_session_id?: string;
                category: string;
                title: string;
                content: string;
              }>;
            };
          };
          const episodic = (data.result?.episodic ?? []).map((ep) => ({
            id: ep.id,
            session_id: ep.session_id,
            role: ep.role,
            content: ep.content,
            kind: "episodic" as const,
          }));
          const semantic = (data.result?.semantic ?? []).map((mem) => ({
            id: mem.id,
            source_session_id: mem.source_session_id,
            category: mem.category,
            title: mem.title,
            content: mem.content,
            kind: "semantic" as const,
          }));
          setBacklogMatches([...semantic, ...episodic]);
        }
      } catch {
        setBacklogMatches([]);
      } finally {
        setSearchingBacklog(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery, ideMessenger]);

  const filteredSessions = sessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.title?.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.summary?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-4 lg:h-full">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <MessageSquare size={14} style={{ color: "#159994" }} />
          {t("memorySessionHistoryTitle")}
        </h2>
        <button
          onClick={() => void loadSessions()}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs opacity-80 hover:opacity-100"
          style={{
            backgroundColor: "var(--vscode-button-secondaryBackground)",
            color: "var(--vscode-button-secondaryForeground)",
          }}
        >
          <RefreshCw size={12} /> {t("memoryRefresh")}
        </button>
      </div>

      <div className="relative shrink-0">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("memorySessionHistorySearch")}
          className="w-full rounded border py-1.5 pl-8 pr-3 text-xs"
          style={{
            borderColor: "var(--vscode-input-border)",
            backgroundColor: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
          }}
        />
      </div>

      {searchQuery.trim().length >= 2 && (
        <div
          className="shrink-0 rounded-lg border"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <div
            className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium opacity-70"
            style={{ borderColor: "var(--vscode-panel-border)" }}
          >
            {searchingBacklog ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Search size={12} />
            )}
            {t("memorySessionHistoryCrossSearch", { count: backlogMatches.length })}
          </div>
          <div className="max-h-48 overflow-y-auto p-2">
            {backlogMatches.length === 0 && !searchingBacklog ? (
              <p className="px-1 py-2 text-xs opacity-50">{t("memorySessionHistoryCrossSearchEmpty")}</p>
            ) : (
              <div className="space-y-1.5">
                {backlogMatches.slice(0, 15).map((match) => {
                  const sid = match.session_id ?? match.source_session_id;
                  return (
                    <button
                      key={`${match.kind}-${match.id}`}
                      type="button"
                      onClick={() => sid && setSelectedId(sid)}
                      className="w-full rounded border px-2 py-1.5 text-left text-xs hover:bg-vsc-list-hoverBackground"
                      style={{ borderColor: "var(--vscode-panel-border)" }}
                    >
                      <div className="font-medium opacity-80">
                        [{match.kind === "semantic" ? match.category : match.role}]
                        {match.title ? ` ${match.title}` : ""}
                      </div>
                      <div className="line-clamp-2 opacity-70">{match.content}</div>
                      {sid && (
                        <div className="mt-0.5 text-[10px] opacity-50">
                          {t("memorySessionHistoryCrossSearchSession", { id: sid.slice(0, 8) })}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 rounded border px-3 py-2 text-xs opacity-80" style={{ borderColor: "#ef4444" }}>
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-1">
        {/* Session list */}
        <div
          className="flex max-h-80 min-h-0 flex-col overflow-hidden rounded-lg border lg:max-h-none lg:h-full"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <div className="shrink-0 border-b px-3 py-2 text-xs font-medium opacity-70" style={{ borderColor: "var(--vscode-panel-border)" }}>
            {t("memorySessionHistoryList", { count: filteredSessions.length })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin opacity-50" />
              </div>
            ) : filteredSessions.length === 0 ? (
              <p className="px-3 py-4 text-xs opacity-50">{t("memoryNoSessionsYet")}</p>
            ) : (
              filteredSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedId(session.id)}
                  className={`flex w-full items-start gap-2 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-vsc-list-hoverBackground ${
                    selectedId === session.id ? "bg-vsc-input-background" : ""
                  }`}
                  style={{ borderColor: "var(--vscode-panel-border)" }}
                >
                  <ChevronRight
                    size={12}
                    className="mt-0.5 shrink-0"
                    style={{ color: selectedId === session.id ? "#159994" : undefined }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {session.title || session.id.slice(0, 12)}
                      {session.is_active && (
                        <span className="ml-1.5 rounded px-1 text-[10px]" style={{ backgroundColor: "#15999420", color: "#159994" }}>
                          {t("memorySessionActive")}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 opacity-50">
                      {t("memoryMsgs", { count: session.message_count ?? 0 })}
                      {" · "}
                      {formatDate(session.updated_at || session.created_at)}
                    </div>
                    {session.summary && (
                      <div className="mt-1 line-clamp-2 opacity-60">{session.summary}</div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Session detail */}
        <div
          className="flex max-h-80 min-h-0 flex-col overflow-hidden rounded-lg border lg:max-h-none lg:h-full"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <div className="shrink-0 border-b px-3 py-2 text-xs font-medium opacity-70" style={{ borderColor: "var(--vscode-panel-border)" }}>
            {selectedId ? t("memorySessionHistoryDetail") : t("memorySessionHistorySelectPrompt")}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!selectedId ? (
              <p className="text-xs opacity-50">{t("memorySessionHistorySelectPrompt")}</p>
            ) : loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin opacity-50" />
              </div>
            ) : history ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="opacity-50">{t("memorySessionHistoryMessages")}</span>
                    <div className="font-medium">{history.message_count}</div>
                  </div>
                  <div>
                    <span className="opacity-50">{t("memorySessionHistoryTokens")}</span>
                    <div className="font-medium">{history.token_estimate.toLocaleString()}</div>
                  </div>
                  <div>
                    <span className="opacity-50">{t("memoryEpisodic")}</span>
                    <div className="font-medium">{history.episodic.length}</div>
                  </div>
                  <div>
                    <span className="opacity-50">{t("memorySemantic")}</span>
                    <div className="font-medium">{history.semantic.length}</div>
                  </div>
                </div>

                {history.topics.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                      <Tag size={12} /> {t("memorySessionHistoryTopics")}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {history.topics.map((topic, i) => (
                        <span
                          key={`${topic.topic}-${i}`}
                          className="rounded px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: "var(--vscode-badge-background)",
                            color: "var(--vscode-badge-foreground)",
                          }}
                        >
                          {topic.topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {history.episodic.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                      <FileText size={12} /> {t("memorySessionHistoryEpisodic")}
                    </div>
                    <div className="space-y-1.5">
                      {history.episodic.slice(0, 20).map((ep) => (
                        <div
                          key={ep.id}
                          className="rounded border px-2 py-1.5 text-xs"
                          style={{ borderColor: "var(--vscode-panel-border)" }}
                        >
                          <div className="mb-0.5 font-medium capitalize opacity-70">{ep.role}</div>
                          <div className="line-clamp-3 opacity-80">{ep.content}</div>
                        </div>
                      ))}
                      {history.episodic.length > 20 && (
                        <p className="text-[10px] opacity-50">
                          {t("memorySessionHistoryTruncated", { count: history.episodic.length - 20 })}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {history.semantic.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                      <Lightbulb size={12} /> {t("memorySessionHistorySemantic")}
                    </div>
                    <div className="space-y-1.5">
                      {history.semantic.slice(0, 10).map((mem) => (
                        <div
                          key={mem.id}
                          className="rounded border px-2 py-1.5 text-xs"
                          style={{ borderColor: "var(--vscode-panel-border)" }}
                        >
                          <div className="font-medium">
                            [{mem.category}] {mem.title}
                          </div>
                          <div className="line-clamp-2 opacity-70">{mem.content}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
