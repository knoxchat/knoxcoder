import { beforeEach, describe, expect, it, vi } from "vitest";

import { hydrateReasoningEffort, setReasoningEffort } from "../slices/uiSlice";
import {
  loadReasoningEffortPrefs,
  saveReasoningEffort,
} from "./reasoningEffort";

describe("reasoning effort persistence thunks", () => {
  const dispatch = vi.fn();
  const post = vi.fn();
  const request = vi.fn();
  const extra = { ideMessenger: { post, request } };

  beforeEach(() => {
    dispatch.mockClear();
    post.mockClear();
    request.mockClear();
  });

  it("saves the selected effort to redux and disk", async () => {
    await saveReasoningEffort({
      effort: "high",
      modelKeys: [
        "deepseek/deepseek-v4-flash",
        "DeepSeek: DeepSeek V4 Flash 0731",
      ],
    })(dispatch, (() => ({})) as any, extra as any);

    expect(dispatch).toHaveBeenCalledWith(
      setReasoningEffort({
        effort: "high",
        modelKeys: [
          "deepseek/deepseek-v4-flash",
          "DeepSeek: DeepSeek V4 Flash 0731",
        ],
      }),
    );
    expect(post).toHaveBeenCalledWith("ui/updateReasoningEffortPrefs", {
      lastEffort: "high",
      byModel: {
        "deepseek/deepseek-v4-flash": "high",
        "DeepSeek: DeepSeek V4 Flash 0731": "high",
      },
    });
  });

  it("hydrates from disk when prefs were saved last session", async () => {
    request.mockResolvedValue({
      status: "success",
      content: {
        lastEffort: "high",
        byModel: { "deepseek/deepseek-v4-flash": "high" },
      },
    });

    await loadReasoningEffortPrefs()(
      dispatch,
      (() => ({
        ui: { reasoningEffort: undefined, reasoningEffortByModel: {} },
      })) as any,
      extra as any,
    );

    expect(dispatch).toHaveBeenCalledWith(
      hydrateReasoningEffort({
        lastEffort: "high",
        byModel: { "deepseek/deepseek-v4-flash": "high" },
      }),
    );
  });

  it("migrates in-memory prefs to disk when disk is empty", async () => {
    request.mockResolvedValue({
      status: "success",
      content: { byModel: {} },
    });

    await loadReasoningEffortPrefs()(
      dispatch,
      (() => ({
        ui: {
          reasoningEffort: "high",
          reasoningEffortByModel: { "deepseek/deepseek-v4-flash": "high" },
        },
      })) as any,
      extra as any,
    );

    expect(dispatch).toHaveBeenCalledWith(
      hydrateReasoningEffort({
        lastEffort: "high",
        byModel: { "deepseek/deepseek-v4-flash": "high" },
      }),
    );
    expect(post).toHaveBeenCalledWith("ui/updateReasoningEffortPrefs", {
      lastEffort: "high",
      byModel: { "deepseek/deepseek-v4-flash": "high" },
    });
  });
});
