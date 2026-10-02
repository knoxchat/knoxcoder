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

  it("recovers Cursor and Claude question shapes", () => {
    const cursor = parseAskUserQuestions({
      title: "Which syscall to add?",
      questions: [
        {
          id: "syscall",
          options: [
            { id: "enosys", label: "Implement an ENOSYS stub" },
            { id: "custom", label: "Add a KnoxOS-specific syscall" },
          ],
        },
      ],
    });
    expect(cursor[0].prompt).toBe("Which syscall to add?");
    expect(cursor[0].options).toEqual([
      "Implement an ENOSYS stub",
      "Add a KnoxOS-specific syscall",
    ]);
    const claude = parseAskUserQuestions({
      questions: [
        {
          header: "Runtime",
          question: "How should this run?",
          options: [{ label: "Terminal", description: "crossterm" }],
        },
      ],
    });
    expect(claude[0].prompt).toBe("How should this run?");
    expect(claude[0].options).toEqual(["Terminal — crossterm"]);
    const singular = parseAskUserQuestions({
      question: "Ship it?",
      options: ["yes", "no"],
    });
    expect(singular[0].prompt).toBe("Ship it?");
  });

  it("throws when nothing question-like is present", () => {
    expect(() => parseAskUserQuestions({})).toThrow(/questions/);
    expect(() => parseAskUserQuestions({ questions: [] })).toThrow(/questions/);
  });
});
