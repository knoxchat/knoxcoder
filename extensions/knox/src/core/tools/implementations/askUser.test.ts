import { describe, expect, it } from "vitest";

import {
  askUserImpl,
  formatAskUserAnswers,
  parseAskUserQuestions,
} from "./askUser";

describe("ask user tool", () => {
  it("parses questions and formats answers", () => {
    const questions = parseAskUserQuestions([
      { prompt: "Which library?", options: ["zod", "joi"] },
      { id: "scope", prompt: "Scope?" },
    ]);
    expect(questions[0].id).toBe("q1");
    expect(questions[1].id).toBe("scope");
    expect(
      formatAskUserAnswers(questions, { q1: "zod", scope: "auth only" }),
    ).toContain("A: zod");
  });

  it("returns answers when provided", async () => {
    const result = await askUserImpl(
      {
        questions: [{ prompt: "Go ahead?" }],
        answers: { q1: "yes" },
      },
      {} as any,
    );
    expect(result[0].name).toBe("answers");
    expect(result[0].content).toContain("A: yes");
  });

  it("notes missing answers", async () => {
    const result = await askUserImpl(
      { questions: [{ prompt: "Go ahead?" }] },
      {} as any,
    );
    expect(result[0].name).toBe("questions");
    expect(result[0].content).toContain("No answers were provided");
  });
});
