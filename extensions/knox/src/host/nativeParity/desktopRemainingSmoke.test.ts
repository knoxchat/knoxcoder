import * as assert from "node:assert";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { requireKnoxHostExtension } from "../util/knoxHostExtension";
import { CheckpointCommand } from "../checkpoints/commandIds";

type KnoxAPI = {
  executeToolCall(
    toolCall: {
      id?: string;
      type?: string;
      function: { name: string; arguments: string };
    },
    selectedModelTitle: string,
  ): Thenable<Array<{ content?: string }>>;
  isAgentModeActive(): Thenable<boolean>;
  toggleAgentMode(): Thenable<void>;
};

type KnoxExtension = {
  getAPI(version: 1): KnoxAPI;
};

const MOCK_MODEL_TITLE = "Test Model";
const SMOKE_FILE = "knox-smoke-edit.txt";

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "Expected an active workspace folder");
  return folder.uri.fsPath;
}

function smokeUri(): vscode.Uri {
  return vscode.Uri.joinPath(
    vscode.workspace.workspaceFolders![0].uri,
    SMOKE_FILE,
  );
}

async function knoxApi(): Promise<KnoxAPI> {
  const extension = requireKnoxHostExtension();
  const activated = (await extension.activate()) as KnoxExtension;
  assert.ok(activated?.getAPI, "Knox activate() should return getAPI");
  return activated.getAPI(1);
}

async function streamChatTokens(apiModelTitle: string): Promise<string> {
  const completed = await vscode.commands.executeCommand<string>(
    "knox.llmComplete",
    { prompt: "KN-144 remaining smoke", title: apiModelTitle },
  );
  if (completed && completed.length > 0) {
    return completed;
  }

  const lm = vscode.lm as unknown as {
    selectAssistModels?(selector: {
      vendor: string;
    }): Thenable<
      Array<{
        sendRequest(
          messages: unknown[],
        ): Thenable<{ text: AsyncIterable<string> }>;
      }>
    >;
  };
  const AssistMessage = (
    vscode as unknown as {
      TextModelApiAssistMessage?: {
        User(content: string): unknown;
      };
    }
  ).TextModelApiAssistMessage;

  if (typeof lm.selectAssistModels !== "function" || !AssistMessage?.User) {
    return "";
  }

  const models = await lm.selectAssistModels({ vendor: "knox" });
  if (!models.length) {
    return "";
  }
  const response = await models[0].sendRequest([
    AssistMessage.User("KN-144 remaining smoke"),
  ]);
  let text = "";
  for await (const chunk of response.text) {
    text += chunk;
  }
  return text;
}

function ensureGitRepo(cwd: string): void {
  const gitDir = path.join(cwd, ".git");
  if (fs.existsSync(gitDir)) {
    return;
  }
  cp.execSync("git init -b main", { cwd });
  cp.execSync("git config user.name knox-smoke", { cwd });
  cp.execSync("git config user.email knox-smoke@example.com", { cwd });
  cp.execSync("git config commit.gpgsign false", { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "hello\n", "utf8");
  cp.execSync("git add .", { cwd });
  cp.execSync('git commit -m "initial smoke commit"', { cwd });
}

suite("KN-144 remaining desktop smoke", function () {
  this.timeout(120_000);

  suiteSetup(async function () {
    await knoxApi();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const text = await vscode.commands.executeCommand<string>(
          "knox.llmComplete",
          { prompt: "ping", title: MOCK_MODEL_TITLE },
        );
        if (text && text.length > 0) {
          return;
        }
      } catch {
        // Config / models are still loading.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail("Knox mock model did not become ready");
  });

  test("chat streams with a configured mock model", async () => {
    await knoxApi();
    const text = await streamChatTokens(MOCK_MODEL_TITLE);
    assert.ok(
      text.length > 0,
      "expected streamed tokens from mock / test LLM",
    );
    assert.match(text, /Test Completion|THIS IS A HARDCODED RESPONSE|PROMPT:/);
  });

  test("agent read + edit + undo", async () => {
    const api = await knoxApi();

    const root = workspaceRoot();
    const readTarget = fs.existsSync(path.join(root, "index.js"))
      ? "index.js"
      : fs.existsSync(path.join(root, "app.js"))
        ? "app.js"
        : SMOKE_FILE;
    if (readTarget === SMOKE_FILE) {
      await vscode.workspace.fs.writeFile(smokeUri(), Buffer.from("seed\n"));
    }

    const read = await api.executeToolCall(
      {
        id: "smoke-read",
        type: "function",
        function: {
          name: "builtin_read_file",
          arguments: JSON.stringify({ filepath: readTarget }),
        },
      },
      MOCK_MODEL_TITLE,
    );
    assert.ok(read.length > 0, "builtin_read_file should return context");
    assert.ok(
      (read[0].content ?? "").length > 0,
      "read content should be non-empty",
    );

    const original = "before-agent-edit\n";
    const edited = "after-agent-edit\n";
    await vscode.workspace.fs.writeFile(smokeUri(), Buffer.from(original));

    const written = await api.executeToolCall(
      {
        id: "smoke-write",
        type: "function",
        function: {
          name: "builtin_write_file",
          arguments: JSON.stringify({
            filepath: SMOKE_FILE,
            contents: edited,
            openAfterWrite: false,
          }),
        },
      },
      MOCK_MODEL_TITLE,
    );
    assert.ok(written.length >= 0, "builtin_write_file should return");
    const afterWrite = Buffer.from(
      await vscode.workspace.fs.readFile(smokeUri()),
    ).toString("utf8");
    assert.strictEqual(afterWrite, edited);

    await vscode.commands.executeCommand("knox.undoLastOperation");
    const afterUndo = Buffer.from(
      await vscode.workspace.fs.readFile(smokeUri()),
    ).toString("utf8");
    assert.strictEqual(afterUndo, original);
  });

  test("checkpoint create / restore", async () => {
    await knoxApi();
    const original = "checkpoint-before\n";
    const changed = "checkpoint-after\n";
    await vscode.workspace.fs.writeFile(smokeUri(), Buffer.from(original));

    const checkpointId = await vscode.commands.executeCommand<string>(
      CheckpointCommand.create,
      { description: "KN-144 remaining smoke" },
    );
    assert.ok(
      checkpointId && checkpointId.length > 0,
      "create with description should return an id without an input box",
    );

    await vscode.workspace.fs.writeFile(smokeUri(), Buffer.from(changed));
    const mid = Buffer.from(
      await vscode.workspace.fs.readFile(smokeUri()),
    ).toString("utf8");
    assert.strictEqual(mid, changed);

    const restored = await vscode.commands.executeCommand<{
      success?: boolean;
    }>(CheckpointCommand.restore, {
      checkpointId,
      confirm: false,
    });
    assert.ok(restored?.success !== false, "direct restore should succeed");
    const afterRestore = Buffer.from(
      await vscode.workspace.fs.readFile(smokeUri()),
    ).toString("utf8");
    assert.strictEqual(afterRestore, original);
  });

  test("Memory panel opens", async () => {
    await knoxApi();
    await vscode.commands.executeCommand("workbench.action.knox.openMemory");
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    const opened = tabs.some((tab) => {
      const input = tab.input as { viewType?: string } | undefined;
      return (
        /memory/i.test(tab.label) ||
        input?.viewType === "workbench.editor.knoxMemory" ||
        input?.viewType === "workbench.input.knoxMemory"
      );
    });
    assert.ok(
      opened,
      `expected Memory editor, got tabs: ${tabs.map((tab) => tab.label).join(", ") || "(none)"}`,
    );
  });

  test("@Diffs / git diff via vscode.git", async () => {
    const api = await knoxApi();
    const root = workspaceRoot();
    ensureGitRepo(root);

    const gitExt = vscode.extensions.getExtension("vscode.git");
    assert.ok(gitExt, "vscode.git should be present");
    await gitExt.activate();

    const appPath = path.join(root, "app.js");
    const appUri = vscode.Uri.file(
      fs.existsSync(appPath) ? appPath : smokeUri().fsPath,
    );
    const previous = fs.existsSync(appUri.fsPath)
      ? fs.readFileSync(appUri.fsPath, "utf8")
      : "hello\n";
    fs.writeFileSync(appUri.fsPath, `${previous}\nsmoke-diff\n`, "utf8");

    const diffs = await api.executeToolCall(
      {
        id: "smoke-diff",
        type: "function",
        function: {
          name: "builtin_git_diff",
          arguments: JSON.stringify({}),
        },
      },
      MOCK_MODEL_TITLE,
    );
    const content = diffs.map((item) => item.content ?? "").join("\n");
    assert.ok(
      /diff|smoke-diff|git diff/i.test(content),
      `expected git diff content via vscode.git, got: ${content.slice(0, 400)}`,
    );
  });
});
