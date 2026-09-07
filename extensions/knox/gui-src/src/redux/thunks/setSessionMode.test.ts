import { describe, expect, it } from "vitest";

import { selectCurrentMode, setMode } from "../slices/sessionSlice";
import sessionReducer from "../slices/sessionSlice";

describe("session mode sync helpers", () => {
  it("setMode switches chat ↔ agent without touching edit session logic", () => {
    let state = sessionReducer(undefined, { type: "unknown" });
    expect(selectCurrentMode({ session: state } as any)).toBe("agent");

    state = sessionReducer(state, setMode("chat"));
    expect(state.mode).toBe("chat");

    state = sessionReducer(state, setMode("agent"));
    expect(state.mode).toBe("agent");
  });
});
