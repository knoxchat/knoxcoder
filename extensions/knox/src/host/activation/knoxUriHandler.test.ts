import * as assert from "node:assert";
import path from "node:path";

import {
  knoxOAuthLoopbackCallbackUrl,
  knoxUriHandlePlan,
  KNOX_URI_IMPORT_SESSION_COMMAND,
  KNOX_URI_OPEN_CHAT_COMMAND,
  parseKnoxUri,
} from "./knoxUriHandler";

suite("knoxUriHandler (KN-356)", () => {
  test("openChat for empty, /chat, and /open", () => {
    assert.strictEqual(parseKnoxUri({ path: "", query: "" }).type, "openChat");
    assert.strictEqual(parseKnoxUri({ path: "/", query: "" }).type, "openChat");
    assert.strictEqual(parseKnoxUri({ path: "/chat", query: "" }).type, "openChat");
    assert.strictEqual(parseKnoxUri({ path: "/open/", query: "" }).type, "openChat");
  });

  test("knox://chat, knox://open, and knoxcoder://vscode.knox/chat open chat", () => {
    assert.strictEqual(
      parseKnoxUri({ scheme: "knox", authority: "chat", path: "/", query: "" }).type,
      "openChat",
    );
    assert.strictEqual(
      parseKnoxUri({ scheme: "knox", authority: "open", path: "/", query: "" }).type,
      "openChat",
    );
    assert.strictEqual(
      parseKnoxUri({
        scheme: "knoxcoder",
        authority: "vscode.knox",
        path: "/chat",
        query: "",
      }).type,
      "openChat",
    );
    assert.deepStrictEqual(
      knoxUriHandlePlan({ type: "openChat" }),
      { kind: "command", command: KNOX_URI_OPEN_CHAT_COMMAND },
    );
    assert.strictEqual(KNOX_URI_OPEN_CHAT_COMMAND, "knox.openChat");
  });

  test("oauth callback forwards query to the loopback URL", () => {
    const action = parseKnoxUri({
      path: "/callback",
      query: "code=abc&state=xyz",
    });
    assert.strictEqual(action.type, "oauthCallback");
    if (action.type !== "oauthCallback") {
      return;
    }
    assert.strictEqual(
      knoxOAuthLoopbackCallbackUrl(action.query),
      "http://127.0.0.1:8733/callback?code=abc&state=xyz",
    );
    const knoxScheme = parseKnoxUri({
      scheme: "knox",
      authority: "callback",
      path: "/",
      query: "code=abc",
    });
    assert.strictEqual(knoxScheme.type, "oauthCallback");
    if (knoxScheme.type === "oauthCallback") {
      assert.deepStrictEqual(knoxUriHandlePlan(knoxScheme), {
        kind: "fetch",
        url: "http://127.0.0.1:8733/callback?code=abc",
      });
    }
  });

  test("unknown paths are ignored", () => {
    assert.strictEqual(parseKnoxUri({ path: "/nope", query: "" }).type, "ignore");
    assert.deepStrictEqual(knoxUriHandlePlan({ type: "ignore" }), { kind: "ignore" });
  });

  test("session import URIs open the import command with the file path", () => {
    const file = path.resolve("/tmp/knox_session.md");
    const encoded = encodeURIComponent(file);
    const knoxcoder = parseKnoxUri({
      scheme: "knoxcoder",
      authority: "vscode.knox",
      path: "/session/import",
      query: `path=${encoded}`,
    });
    assert.strictEqual(knoxcoder.type, "importSession");
    if (knoxcoder.type === "importSession") {
      assert.strictEqual(knoxcoder.path, file);
      assert.deepStrictEqual(knoxUriHandlePlan(knoxcoder), {
        kind: "command",
        command: KNOX_URI_IMPORT_SESSION_COMMAND,
        args: [file],
      });
    }
    const knoxScheme = parseKnoxUri({
      scheme: "knox",
      authority: "session",
      path: "/import",
      query: `path=${encoded}`,
    });
    assert.strictEqual(knoxScheme.type, "importSession");
    const picker = parseKnoxUri({
      scheme: "knoxcoder",
      authority: "vscode.knox",
      path: "/session/import",
      query: "",
    });
    assert.deepStrictEqual(knoxUriHandlePlan(picker), {
      kind: "command",
      command: KNOX_URI_IMPORT_SESSION_COMMAND,
    });
    assert.strictEqual(
      parseKnoxUri({
        scheme: "knoxcoder",
        authority: "vscode.knox",
        path: "/session/import",
        query: "path=https://example.com/x.md",
      }).type,
      "importSession",
    );
    const blocked = parseKnoxUri({
      scheme: "knoxcoder",
      authority: "vscode.knox",
      path: "/session/import",
      query: "path=https://example.com/x.md",
    });
    if (blocked.type === "importSession") {
      assert.strictEqual(blocked.path, undefined);
    }
  });

  test("non-Knox authorities and schemes are ignored", () => {
    assert.strictEqual(
      parseKnoxUri({ authority: "vscode.git", path: "/chat", query: "" }).type,
      "ignore",
    );
    assert.strictEqual(
      parseKnoxUri({
        scheme: "https",
        authority: "vscode.knox",
        path: "/chat",
        query: "",
      }).type,
      "ignore",
    );
  });
});
