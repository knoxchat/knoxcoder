import { writeFileAtomic } from "./atomicWrite.js";
import { withFileLockSync } from "./fileLock.js";
import * as fs from "fs";

import { Session, SessionMetadata } from "../index.js";
import { t } from "../i18n/index.js";
import { ListHistoryOptions } from "../protocol/core.js";

import { NEW_SESSION_TITLE } from "./constants.js";
import { getSessionFilePath, getSessionsListPath } from "./paths.js";
import { SESSION_SEARCH_MAX_FILE_BYTES, SESSION_SEARCH_MIN_QUERY, searchSessions, type SessionSearchHit } from "./sessionSearch.js";
import { capSessionForStorage } from "./sessionSizeCap.js";
import { SESSION_SCHEMA_VERSION, backupOnce, sessionVersionOf } from "./schemaVersions.js";
function safeParseArray<T>(
  value: string,
  errorMessage: string = "Error parsing array",
): T[] | undefined {
  try {
    return JSON.parse(value) as T[];
  } catch (e: any) {
    console.warn(`${errorMessage}: ${e}`);
    return undefined;
  }
}

class HistoryManager {
  list(options: ListHistoryOptions): SessionMetadata[] {
    const filepath = getSessionsListPath();
    if (!fs.existsSync(filepath)) {
      return [];
    }
    const content = fs.readFileSync(filepath, "utf8");

    let sessions = safeParseArray<SessionMetadata>(content) ?? [];
    sessions = sessions.filter((session: any) => {
      // Filter out old format
      return typeof session.session_id !== "string";
    });

    // Filter by workspace directory if provided
    if (options.workspaceDirectory) {
      sessions = sessions.filter((session) => {
        if (!session.workspaceDirectory) {
          return false;
        }
        
        // Normalize both paths for comparison
        const normalizeWorkspacePath = (path: string) => {
          // Convert file:// URI to file path if needed
          if (path.startsWith('file://')) {
            path = path.replace(/^file:\/\//, '');
          }
          // Remove trailing slashes for consistent comparison
          return path.replace(/\/$/, '');
        };
        
        const sessionWorkspace = normalizeWorkspacePath(session.workspaceDirectory);
        const currentWorkspace = normalizeWorkspacePath(options.workspaceDirectory!);
        
        return sessionWorkspace === currentWorkspace;
      });
    }

    // Sort by dateCreated (most recent first) to ensure consistent ordering
    sessions = sessions.sort((a, b) => {
      const dateA = parseInt(a.dateCreated);
      const dateB = parseInt(b.dateCreated);
      return dateB - dateA; // Most recent first
    });

    // Apply limit and offset
    if (options.limit) {
      const offset = options.offset || 0;
      sessions = sessions.slice(offset, offset + options.limit);
    }

    return sessions;
  }

  /** K-043: content search over the sessions of the workspace, newest first. */
  search(options: { query: string; workspaceDirectory?: string; limit?: number }): SessionSearchHit[] {
    if (options.query.trim().length < SESSION_SEARCH_MIN_QUERY) {
      return [];
    }
    const entries = this.list({ workspaceDirectory: options.workspaceDirectory }).map((meta) => ({
      sessionId: meta.sessionId,
      read: () => {
        const file = getSessionFilePath(meta.sessionId);
        if (!fs.existsSync(file) || fs.statSync(file).size > SESSION_SEARCH_MAX_FILE_BYTES) {
          return undefined;
        }
        return JSON.parse(fs.readFileSync(file, "utf8")) as Session;
      },
    }));
    return searchSessions(entries, options.query, options.limit);
  }

  delete(sessionId: string) {
    // Delete a session
    const sessionFile = getSessionFilePath(sessionId);
    if (!fs.existsSync(sessionFile)) {
      throw new Error(t("sessionFileNotExist", { file: sessionFile }));
    }
    fs.unlinkSync(sessionFile);

    // Read-modify-write of sessions.json under a cross-window lock so two
    // windows deleting/saving at once cannot drop each other's entries.
    const sessionsListFile = getSessionsListPath();
    withFileLockSync(`${sessionsListFile}.lock`, () => {
      const sessionsListRaw = fs.readFileSync(sessionsListFile, "utf-8");
      let sessionsList =
        safeParseArray<SessionMetadata>(
          sessionsListRaw,
          "Error parsing sessions.json",
        ) ?? [];

      sessionsList = sessionsList.filter(
        (session) => session.sessionId !== sessionId,
      );

      writeFileAtomic(
        sessionsListFile,
        JSON.stringify(sessionsList, undefined, 2),
      );
    });
  }

  load(sessionId: string): Session {
    try {
      const sessionFile = getSessionFilePath(sessionId);
      if (!fs.existsSync(sessionFile)) {
        throw new Error(t("sessionFileNotExist", { file: sessionFile }));
      }
      const session: Session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      session.sessionId = sessionId;
      if (sessionVersionOf(session) > SESSION_SCHEMA_VERSION) {
        console.warn(
          `Session ${sessionId} was written by a newer Knox (schema ${session.schemaVersion}); loading best-effort.`,
        );
      }
      return session;
    } catch (e) {
      console.log(t("errorLoadingSession", { error: String(e) }));
      return {
        history: [],
        title: NEW_SESSION_TITLE,
        workspaceDirectory: "",
        sessionId: sessionId,
      };
    }
  }

  save(input: Session) {
    // K-043: a runaway session is shrunk (oldest tool dumps first) instead of growing forever.
    const session = capSessionForStorage(input).session;
    // Save the main session json file
    // Explicitely rewriting here to influence the written key order in the file!
    // e.g. id at the top, history next, etc.
    const sessionFilePath = getSessionFilePath(session.sessionId);
    try {
      if (fs.existsSync(sessionFilePath)) {
        const existing = sessionVersionOf(
          JSON.parse(fs.readFileSync(sessionFilePath, "utf8")),
        );
        if (existing !== SESSION_SCHEMA_VERSION) {
          // Older (unversioned) or newer file: keep it once before rewriting.
          backupOnce(sessionFilePath, existing);
        }
      }
    } catch {
      // Unreadable file is about to be replaced by a valid one.
    }
    const orderedSession: Session = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: session.sessionId,
      title: session.title,
      workspaceDirectory: session.workspaceDirectory,
      history: session.history,
    };
    writeFileAtomic(
      getSessionFilePath(session.sessionId),
      JSON.stringify(orderedSession, undefined, 2),
    );

    // Read and update the sessions list
    const sessionsListFilePath = getSessionsListPath();
    try {
      withFileLockSync(`${sessionsListFilePath}.lock`, () => {
        const rawSessionsList = fs.readFileSync(sessionsListFilePath, "utf-8");

        let sessionsList: SessionMetadata[];
        try {
          sessionsList = JSON.parse(rawSessionsList);
        } catch (e) {
          if (rawSessionsList.trim() === "") {
            writeFileAtomic(sessionsListFilePath, JSON.stringify([]));
            sessionsList = [];
          } else {
            throw e;
          }
        }

        let found = false;
        for (const sessionMetadata of sessionsList) {
          if (sessionMetadata.sessionId === session.sessionId) {
            sessionMetadata.title = session.title;
            sessionMetadata.workspaceDirectory = session.workspaceDirectory;
            found = true;
            break;
          }
        }

        if (!found) {
          const sessionMetadata: SessionMetadata = {
            sessionId: session.sessionId,
            title: session.title,
            dateCreated: String(Date.now()),
            workspaceDirectory: session.workspaceDirectory,
          };
          sessionsList.push(sessionMetadata);
        }

        writeFileAtomic(
          sessionsListFilePath,
          JSON.stringify(sessionsList, undefined, 2),
        );
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          t("sessionsJsonFormatError", { path: sessionsListFilePath }),
        );
      }
      throw new Error(
        t("sessionsJsonValidationError", { path: sessionsListFilePath, error: String(error) }),
      );
    }
  }
}

const historyManager = new HistoryManager();

export default historyManager;
