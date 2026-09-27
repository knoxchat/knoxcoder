/**
 * Fail-closed validation helpers for agent tool calls.
 * Incomplete required args must be rejected — never filled with TODO placeholders.
 */

export type ToolParamSpec = {
  name: string;
  requiredParams: string[];
  optionalParams?: string[];
};

export function isMissingToolArg(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string" && value.trim() === "") {
    return true;
  }
  return false;
}

/**
 * Returns missing required param names. Empty strings count as missing.
 */
export function findMissingRequiredParams(
  tool: ToolParamSpec,
  args: Record<string, unknown>,
): string[] {
  return tool.requiredParams.filter((param) => isMissingToolArg(args[param]));
}

/**
 * Model-visible rejection message for incomplete tool calls.
 */
export function incompleteToolCallMessage(
  toolName: string,
  missingParams: string[],
): string {
  return (
    `Incomplete tool call for "${toolName}": missing required parameter(s) ` +
    `${missingParams.join(", ")}. ` +
    `Re-issue the tool call with complete arguments; placeholders are not accepted.`
  );
}
