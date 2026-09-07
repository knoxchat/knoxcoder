import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";

import sessionReducer, {
  addSessionToolAllowlist,
  newSession,
  removeSessionToolAllowlist,
} from "./sessionSlice";

describe("sessionToolAllowlist", () => {
  it("adds unique tool names and can revoke Always from the list", () => {
    let state = sessionReducer(undefined, { type: "unknown" });
    expect(state.sessionToolAllowlist).toEqual([]);

    state = sessionReducer(
      state,
      addSessionToolAllowlist(BuiltInToolNames.CreateNewFile),
    );
    state = sessionReducer(
      state,
      addSessionToolAllowlist(BuiltInToolNames.CreateNewFile),
    );
    expect(state.sessionToolAllowlist).toEqual([
      BuiltInToolNames.CreateNewFile,
    ]);

    state = sessionReducer(
      state,
      removeSessionToolAllowlist(BuiltInToolNames.CreateNewFile),
    );
    expect(state.sessionToolAllowlist).toEqual([]);
  });

  it("clears session Always on a new chat", () => {
    let state = sessionReducer(
      undefined,
      addSessionToolAllowlist(BuiltInToolNames.SearchWeb),
    );
    state = sessionReducer(state, newSession(undefined));
    expect(state.sessionToolAllowlist).toEqual([]);
  });
});
