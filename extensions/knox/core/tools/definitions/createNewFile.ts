import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const createNewFileTool: Tool = {
  type: "function",
  displayTitle: t("createNewFile"),
  wouldLikeTo: t("wouldLikeToCreateFile"),
  isCurrently: t("isCreatingFile"),
  hasAlready: t("hasCreatedFile"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.CreateNewFile,
    description: `Create a new file with intelligent features:
- Auto-detects file type from extension
- Creates necessary parent directories
- Supports templates for common file types
- Can open file after creation
- Validates file paths and prevents overwrites
- Supports workspace-relative or absolute paths

Use this only when the file does not exist yet. For a surgical change to an existing file use builtin_edit_file. For a full rewrite use builtin_write_file. Never write files via the terminal.`,
    parameters: {
      type: "object",
      required: ["filepath", "contents"],
      properties: {
        filepath: {
          type: "string",
          description:
            "The path of the new file, relative to the workspace root. Can include subdirectories (will be created automatically). Examples: 'src/components/Button.tsx', 'utils/helper.js', 'README.md'",
        },
        contents: {
          type: "string",
          description: "The content to write to the new file. Can be empty string for blank files.",
        },
        template: {
          type: "string",
          enum: [
            "none",
            "typescript-react",
            "typescript-class",
            "typescript-interface",
            "typescript-function",
            "javascript-react",
            "javascript-module",
            "python-script",
            "python-class",
            "java-class",
            "rust-module",
            "go-package",
            "markdown",
            "html",
            "css",
            "json",
            "yaml",
            "dockerfile",
            "gitignore",
            "test-vitest",
            "config-eslint",
            "config-prettier",
            "config-tsconfig"
          ],
          description: "Optional template to use. If specified, will generate boilerplate code. Set to 'none' or omit to use custom content."
        },
        openAfterCreate: {
          type: "boolean",
          description: "Whether to open the file in the editor after creation. Default: true"
        },
        createDirectories: {
          type: "boolean",
          description: "Whether to create parent directories if they don't exist. Default: true"
        },
        overwrite: {
          type: "boolean",
          description: "Whether to overwrite the file if it already exists. Default: false (will throw error if file exists)"
        },
        encoding: {
          type: "string",
          enum: ["utf8", "utf-8", "ascii", "base64", "binary"],
          description: "File encoding to use. Default: utf-8"
        },
        language: {
          type: "string",
          description: "Optional language identifier for syntax highlighting (e.g., 'typescript', 'python', 'markdown'). Auto-detected from extension if not provided."
        }
      },
    },
  },
};
