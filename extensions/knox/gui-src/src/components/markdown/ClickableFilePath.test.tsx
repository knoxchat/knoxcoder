import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import ClickableFilePath from "./ClickableFilePath";

const openFileInEditor = vi.fn();

vi.mock("../../util/openFileInEditor", async () => {
  const actual = await vi.importActual<
    typeof import("../../util/openFileInEditor")
  >("../../util/openFileInEditor");
  return {
    ...actual,
    openFileInEditor: (...args: unknown[]) => openFileInEditor(...args),
  };
});

vi.mock("../FileIcon", () => ({
  default: ({ filename }: { filename: string }) => (
    <span data-testid="file-icon">{filename}</span>
  ),
}));

describe("ClickableFilePath", () => {
  const ideMessenger = { post: vi.fn(), ide: {} } as any;

  beforeEach(() => {
    openFileInEditor.mockReset();
  });

  it("renders the directory and clickable filename", () => {
    render(
      <IdeMessengerContext.Provider value={ideMessenger}>
        <ClickableFilePath filepath="tetris/src/main.rs" />
      </IdeMessengerContext.Provider>,
    );

    expect(screen.getByText("tetris/src/")).toBeTruthy();
    expect(screen.getByText("main.rs")).toBeTruthy();
  });

  it("opens the file in the editor when the filename is clicked", () => {
    render(
      <IdeMessengerContext.Provider value={ideMessenger}>
        <ClickableFilePath filepath="tetris/src/main.rs" startLine={483} />
      </IdeMessengerContext.Provider>,
    );

    fireEvent.click(screen.getByTestId("clickable-file-path"));

    expect(openFileInEditor).toHaveBeenCalledWith(
      ideMessenger,
      "tetris/src/main.rs",
      { startLine: 483, endLine: undefined },
    );
  });
});
