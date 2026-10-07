import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  knoxUriHandlePlan,
  KNOX_URI_IMPORT_SESSION_COMMAND,
  parseKnoxUri,
} from "./knoxUriHandler";

describe("knoxUriHandler session import", () => {
  it("knoxcoder://vscode.knox/session/import?path= runs import with the file", () => {
    const file = path.resolve("/tmp/knox_session.md");
    const action = parseKnoxUri({
      scheme: "knoxcoder",
      authority: "vscode.knox",
      path: "/session/import",
      query: `path=${encodeURIComponent(file)}`,
    });
    expect(action).toEqual({ type: "importSession", path: file });
    expect(knoxUriHandlePlan(action)).toEqual({
      kind: "command",
      command: KNOX_URI_IMPORT_SESSION_COMMAND,
      args: [file],
    });
  });

  it("knox://session/import without a path opens the picker", () => {
    const action = parseKnoxUri({
      scheme: "knox",
      authority: "session",
      path: "/import",
      query: "",
    });
    expect(action.type).toBe("importSession");
    expect(knoxUriHandlePlan(action)).toEqual({
      kind: "command",
      command: KNOX_URI_IMPORT_SESSION_COMMAND,
    });
  });

  it("rejects http(s) path values", () => {
    const action = parseKnoxUri({
      scheme: "knoxcoder",
      authority: "vscode.knox",
      path: "/session/import",
      query: "path=https://example.com/x.md",
    });
    expect(action.type).toBe("importSession");
    if (action.type === "importSession") {
      expect(action.path).toBeUndefined();
    }
  });
});
