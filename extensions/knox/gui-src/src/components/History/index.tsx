import MiniSearch from "minisearch";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { deleteSession, refreshSessionMetadata } from "../../redux/thunks/session";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { Search, X, CheckSquare, Square, Trash2, Info, Check } from "lucide-react";
import Shortcut from "../gui/Shortcut";

import { HistoryTableRow } from "./HistoryTableRow";
import { parseDate } from "./parseDate";

export function History() {
  const { t } = useTranslation();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const dispatch = useAppDispatch();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  const minisearch = useRef<MiniSearch>(
    new MiniSearch({
      fields: ["title"],
      storeFields: ["title", "sessionId", "id"],
    }),
  ).current;

  const allSessionMetadata = useAppSelector(
    (state) => state.session.allSessionMetadata,
  );

  // Load sessions when component mounts
  useEffect(() => {
    dispatch(refreshSessionMetadata({}));
  }, [dispatch]);

  useEffect(() => {
    try {
      minisearch.removeAll();
      minisearch.addAll(
        allSessionMetadata.map((session) => ({
          title: session.title,
          sessionId: session.sessionId,
          id: session.sessionId,
        })),
      );
    } catch (e) {
      console.log("Error adding session to mini search", e);
    }
  }, [allSessionMetadata]);

  const filteredAndSortedSessions = useMemo(() => {
    const sessionIds = minisearch
      .search(searchTerm, {
        fuzzy: 0.1,
      })
      .map((result) => result.id);

    return allSessionMetadata
      .filter((session) => {
        return searchTerm === "" || sessionIds.includes(session.sessionId);
      })
      .sort(
        (a, b) =>
          parseDate(b.dateCreated).getTime() -
          parseDate(a.dateCreated).getTime(),
      );
  }, [allSessionMetadata, searchTerm, minisearch]);

  const handleSelectSession = (sessionId: string, selected: boolean) => {
    const newSelection = new Set(selectedSessions);
    if (selected) {
      newSelection.add(sessionId);
    } else {
      newSelection.delete(sessionId);
    }
    setSelectedSessions(newSelection);
  };
  
  const handleSelectAll = () => {
    const newSelection = new Set<string>();
    filteredAndSortedSessions.forEach(session => {
      newSelection.add(session.sessionId);
    });
    setSelectedSessions(newSelection);
  };
  
  const handleUnselectAll = () => {
    setSelectedSessions(new Set());
  };
  
  const handleDeleteSelected = async () => {
    setShowDeleteConfirmation(true);
  };
  
  const confirmDeleteSelected = async () => {
    // Delete all selected sessions one by one
    const deletePromises = Array.from(selectedSessions).map(sessionId => 
      dispatch(deleteSession(sessionId))
    );
    
    await Promise.all(deletePromises);
    setSelectedSessions(new Set());
    setIsSelectionMode(false);
    setShowDeleteConfirmation(false);
    
    // Refresh the session metadata
    dispatch(refreshSessionMetadata({}));
  };
  
  const cancelDelete = () => {
    setShowDeleteConfirmation(false);
  };

  const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24);
  const lastWeek = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);
  const lastMonth = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);

  return (
    <div className="@container min-w-0 space-y-3 overflow-x-hidden p-2">
      {/* Header */}
      <div className="flex min-w-0 flex-col space-y-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-base font-bold leading-tight text-foreground @[20rem]:text-xl">{t('conversationHistory')}</h1>
          <Badge variant="secondary" className="max-w-full shrink-0 truncate text-xs @[20rem]:text-sm">
            {filteredAndSortedSessions.length} {filteredAndSortedSessions.length === 1 ? t('conversation') : t('conversations')}
          </Badge>
        </div>
        
        {/* Search */}
        <div className="relative w-full min-w-0">
          <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder={t('searchConversations')}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="min-w-0 pl-10 pr-10"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
              onClick={() => {
                setSearchTerm("");
                if (searchInputRef.current) {
                  searchInputRef.current.focus();
                }
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {filteredAndSortedSessions.length === 0 ? (
        <Card className="min-w-0 p-4">
          <CardContent className="space-y-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted @[20rem]:h-16 @[20rem]:w-16">
              <Search className="h-6 w-6 text-muted-foreground @[20rem]:h-8 @[20rem]:w-8" />
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-base font-medium @[20rem]:text-lg">{t('noConversationsFound')}</h3>
              <p className="mx-auto max-w-md text-sm break-words text-muted-foreground">
                {t('noConversationsMessage')}{" "}
                <Shortcut>meta L</Shortcut>
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Sticky Actions Bar */}
          <div className="sticky top-0 z-10 -mx-2 mb-3 min-w-0 border-b border-border/40 bg-background/95 p-2 backdrop-blur supports-backdrop-filter:bg-background/60">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                {selectedSessions.size > 0 && (
                  <Badge variant="secondary" className="flex items-center gap-1 text-xs @[20rem]:text-sm">
                    <Check className="h-3 w-3 shrink-0" />
                    <span>{selectedSessions.size}</span>
                  </Badge>
                )}
              </div>

              <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 @[20rem]:gap-2">
                {!isSelectionMode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsSelectionMode(true)}
                    className="gap-1"
                    title={t('selectMultipleConversations')}
                  >
                    <CheckSquare className="h-3 w-3 shrink-0" />
                    <span className="hidden @[18rem]:inline">{t('select')}</span>
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSelectAll}
                      className="gap-1"
                      title={t('selectAllConversations')}
                    >
                      <CheckSquare className="h-3 w-3 shrink-0" />
                      <span className="hidden @[28rem]:inline">{t('selectAll')}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnselectAll}
                      className="gap-1"
                      title={t('clear')}
                    >
                      <Square className="h-3 w-3 shrink-0" />
                      <span className="hidden @[28rem]:inline">{t('clear')}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteSelected}
                      disabled={selectedSessions.size === 0}
                      className="gap-1 text-red hover:text-red hover:bg-red-50"
                      title={t('deleteSelectedConversations', { count: selectedSessions.size })}
                    >
                      <Trash2 className="h-3 w-3 shrink-0" />
                      <span className="hidden @[20rem]:inline">{t('delete')} ({selectedSessions.size})</span>
                      <span className="@[20rem]:hidden">({selectedSessions.size})</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsSelectionMode(false);
                        setSelectedSessions(new Set());
                      }}
                      className="gap-1"
                      title={t('exitSelectionMode')}
                    >
                      <X className="h-3 w-3 shrink-0" />
                      <span className="hidden @[18rem]:inline">{t('exit')}</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Grouped sessions by date */}
          <div className="min-w-0 space-y-2">
            {(() => {
              let sections: {
                header: string;
                sessions: typeof filteredAndSortedSessions;
              }[] = [];
              let currentSection = "";
              let currentSessions: typeof filteredAndSortedSessions = [];

              filteredAndSortedSessions.forEach((session, index) => {
                const date = parseDate(session.dateCreated);
                let section = "";

                if (date > yesterday) {
                  section = t('today');
                } else if (date > lastWeek) {
                  section = t('thisWeek');
                } else if (date > lastMonth) {
                  section = t('thisMonth');
                } else {
                  section = t('earlierConversations');
                }

                if (section !== currentSection) {
                  if (currentSection) {
                    sections.push({
                      header: currentSection,
                      sessions: currentSessions,
                    });
                  }
                  currentSection = section;
                  currentSessions = [session];
                } else {
                  currentSessions.push(session);
                }

                // Handle the last session
                if (index === filteredAndSortedSessions.length - 1) {
                  sections.push({
                    header: currentSection,
                    sessions: currentSessions,
                  });
                }
              });

              return sections.map(({ header, sessions }) => (
                <div key={header} className="min-w-0 space-y-3">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <h2 className="min-w-0 truncate text-base font-semibold text-foreground @[20rem]:text-lg">{header}</h2>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {sessions.length} {sessions.length === 1 ? t('item') : t('items')}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="min-w-0 space-y-3">
                    {sessions.map((session, idx) => (
                      <HistoryTableRow
                        key={session.sessionId}
                        sessionMetadata={session}
                        date={parseDate(session.dateCreated)}
                        index={idx}
                        isSelectionMode={isSelectionMode}
                        isSelected={selectedSessions.has(session.sessionId)}
                        onSelect={(selected) =>
                          handleSelectSession(session.sessionId, selected)
                        }
                      />
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </>
      )}

      {/* Footer Info */}
      <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground @[20rem]:items-center @[20rem]:text-sm">
        <Info className="mt-0.5 h-3 w-3 shrink-0 @[20rem]:mt-0" />
        <span className="min-w-0 break-words">{t('conversationsDataStoredAt')}</span>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="mx-auto w-full max-w-md min-w-0 border-red-500/20">
            <CardHeader>
              <CardTitle className="text-red break-words">{t('deleteConversations')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="min-w-0 space-y-2">
                <p className="text-sm break-words">
                  {t('confirmDeleteConversations', { count: selectedSessions.size })}{" "}
                  {selectedSessions.size === 1 ? t('conversation') : t('conversations')}?
                </p>
                <p className="text-xs break-words text-muted-foreground">
                  {t('actionCannotBeUndone')}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={cancelDelete}>
                  {t('cancel')}
                </Button>
                <Button 
                  className="bg-red hover:bg-red-500 text-white" 
                  onClick={confirmDeleteSelected}
                >
                  {t('delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
