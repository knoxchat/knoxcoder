import { BuiltInToolNames } from "core/tools/builtIn";
import { describe, expect, it } from "vitest";

import { collapseFileToolCodePreview } from "./collapseFileToolCodePreview";

describe("collapseFileToolCodePreview", () => {
  it("collapses read-file tool previews", () => {
    expect(collapseFileToolCodePreview(BuiltInToolNames.ReadFile)).toBe(true);
    expect(collapseFileToolCodePreview("read_file")).toBe(true);
    expect(
      collapseFileToolCodePreview(BuiltInToolNames.ReadCurrentlyOpenFile),
    ).toBe(true);
  });

  it("leaves write and edit previews free to expand", () => {
    expect(collapseFileToolCodePreview(BuiltInToolNames.WriteFile)).toBe(false);
    expect(collapseFileToolCodePreview(BuiltInToolNames.EditFile)).toBe(false);
    expect(collapseFileToolCodePreview(BuiltInToolNames.CreateNewFile)).toBe(
      false,
    );
  });
});
