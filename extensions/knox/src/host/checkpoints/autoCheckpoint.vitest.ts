import { afterEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { turnIntents } from "core/context/soul/turnIntent";

import { AutoCheckpointSystem } from "./AutoCheckpointSystem";

function stubWindow(): void {
  const w = vscode.window as unknown as Record<string, unknown>;
  w.showInformationMessage = async () => undefined;
  w.showWarningMessage = async () => undefined;
  w.showErrorMessage = async () => undefined;
}

describe("AutoCheckpointSystem T4", () => {
  afterEach(() => {
    turnIntents.finish("sess-t4");
  });

  it("undo restores A from [A,B]; pre-undo snapshot is the redo target", async () => {
    stubWindow();
    const auto = AutoCheckpointSystem.getInstance() as any;
    const origManager = auto.checkpointManager;
    const origUndo = {
      ...auto.undoRedoState,
      stack: [...auto.undoRedoState.stack],
    };
    const restored: string[] = [];

    auto.undoRedoState = { currentIndex: -1, stack: [], maxSize: 50 };
    auto.addToUndoStack("A");
    auto.addToUndoStack("B");
    auto.checkpointManager = {
      createCheckpointForMessage: async () => {
        auto.addToUndoStack("C");
        return "C";
      },
      restoreCheckpoint: async (checkpointId: string) => {
        restored.push(checkpointId);
        return { success: true };
      },
      getStoragePath: () => undefined,
    };

    try {
      expect(await auto.undo()).toBe(true);
      expect(restored).toEqual(["A"]);
      expect(auto.undoRedoState.stack).toEqual(["A", "C"]);
      expect(auto.canRedo()).toBe(true);

      expect(await auto.redo()).toBe(true);
      expect(restored).toEqual(["A", "C"]);
    } finally {
      auto.checkpointManager = origManager;
      auto.undoRedoState = origUndo;
    }
  });

  it("file-threshold auto collapses into the labeled turn checkpoint", async () => {
    const auto = AutoCheckpointSystem.getInstance() as any;
    const origManager = auto.checkpointManager;
    const origConfig = auto.config;
    const origPending = new Set(auto.pendingChanges);
    const origCreate = auto.createAutoCheckpoint;
    let created = false;

    auto.config = {
      ...auto.config,
      enabled: true,
      minIntervalMs: 1,
      fileChangeThreshold: 2,
    };
    auto.lastCheckpointTime = 0;
    auto.pendingChanges = new Set(["a.ts", "b.ts"]);
    auto.createAutoCheckpoint = async () => {
      created = true;
      return "auto-extra";
    };
    auto.checkpointManager = {
      getBoundAgentSessionId: () => "sess-t4",
      getStoragePath: () => undefined,
    };
    turnIntents.begin("sess-t4", "edit the files");

    try {
      await auto.checkAutoCheckpointTrigger();
      expect(created).toBe(false);
      expect(auto.pendingChanges.size).toBe(0);
    } finally {
      auto.checkpointManager = origManager;
      auto.config = origConfig;
      auto.pendingChanges = origPending;
      auto.createAutoCheckpoint = origCreate;
    }
  });

  it("pre-risky adopts a new safety snapshot as the turn checkpoint", async () => {
    const auto = AutoCheckpointSystem.getInstance() as any;
    const origManager = auto.checkpointManager;
    const origConfig = auto.config;
    const origCreate = auto.createAutoCheckpoint;
    const origLast = auto.lastCheckpointTime;
    const adopted: string[] = [];
    auto.config = { ...auto.config, enabled: true, checkpointBeforeRisky: true, minIntervalMs: 1 };
    auto.lastCheckpointTime = 0;
    auto.createAutoCheckpoint = async () => "auto-pre-risky";
    auto.checkpointManager = {
      peekTurnCheckpoint: () => undefined,
      adoptTurnCheckpoint: (sessionId: string, turnId: string, checkpointId: string) => {
        adopted.push(`${sessionId}:${turnId}:${checkpointId}`);
      },
      getBoundAgentSessionId: () => "sess-t4",
      getStoragePath: () => undefined,
    };

    try {
      const id = await auto.onBeforeRiskyOperation("builtin_edit_file", {
        sessionId: "sess-t4",
        turnId: "turn-1",
      });
      expect(id).toBe("auto-pre-risky");
      expect(adopted).toEqual(["sess-t4:turn-1:auto-pre-risky"]);
    } finally {
      auto.checkpointManager = origManager;
      auto.config = origConfig;
      auto.createAutoCheckpoint = origCreate;
      auto.lastCheckpointTime = origLast;
    }
  });

  it("pre-risky reuses the existing turn checkpoint id", async () => {
    const auto = AutoCheckpointSystem.getInstance() as any;
    const origManager = auto.checkpointManager;
    const origCreate = auto.createAutoCheckpoint;
    let created = false;
    auto.createAutoCheckpoint = async () => {
      created = true;
      return "auto-pre-risky";
    };
    auto.checkpointManager = {
      peekTurnCheckpoint: () => "turn-cp-1",
      adoptTurnCheckpoint: () => undefined,
      getBoundAgentSessionId: () => "sess-t4",
      getStoragePath: () => undefined,
    };

    try {
      const id = await auto.onBeforeRiskyOperation("builtin_edit_file", {
        sessionId: "sess-t4",
        turnId: "turn-1",
      });
      expect(id).toBe("turn-cp-1");
      expect(created).toBe(false);
    } finally {
      auto.checkpointManager = origManager;
      auto.createAutoCheckpoint = origCreate;
    }
  });
});
