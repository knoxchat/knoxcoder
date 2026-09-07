import React from "react";
import { cn } from "@/lib/utils";
import { getFontSize } from "../util";

export const VSC_INPUT_BACKGROUND_VAR = "--vscode-input-background";
export const VSC_BACKGROUND_VAR = "--vscode-sideBar-background";
export const VSC_FOREGROUND_VAR = "--vscode-editor-foreground";
export const VSC_BUTTON_BACKGROUND_VAR = "--vscode-button-background";
export const VSC_BUTTON_FOREGROUND_VAR = "--vscode-button-foreground";
export const VSC_EDITOR_BACKGROUND_VAR = "--vscode-editor-background";
export const VSC_LIST_SELECTION_BACKGROUND_VAR =
  "--vscode-list-activeSelectionBackground";
export const VSC_FOCUS_BORDER_VAR = "--vscode-focusBorder";
export const VSC_LIST_ACTIVE_FOREGROUND_VAR =
  "--vscode-quickInputList-focusForeground";
export const VSC_QUICK_INPUT_BACKGROUND_VAR = "--vscode-quickInput-background";
export const VSC_INPUT_BORDER_VAR = "--vscode-input-border";
export const VSC_BADGE_BACKGROUND_VAR = "--vscode-badge-background";
export const VSC_BADGE_FOREGROUND_VAR = "--vscode-badge-foreground";
export const VSC_COMMAND_CENTER_ACTIVE_BORDER_VAR =
  "--vscode-commandCenter-activeBorder";
export const VSC_COMMAND_CENTER_INACTIVE_BORDER_VAR =
  "--vscode-commandCenter-inactiveBorder";
export const VSC_FIND_MATCH_SELECTED_VAR =
  "--vscode-editor-findMatchHighlightBackground";
export const VSC_EDITOR_LINE_NUMBER_VAR = "--vscode-editorLineNumber-foreground";

export const VSC_THEME_COLOR_VARS = [
  VSC_INPUT_BACKGROUND_VAR,
  VSC_BACKGROUND_VAR,
  VSC_FOREGROUND_VAR,
  VSC_BUTTON_BACKGROUND_VAR,
  VSC_BUTTON_FOREGROUND_VAR,
  VSC_EDITOR_BACKGROUND_VAR,
  VSC_LIST_SELECTION_BACKGROUND_VAR,
  VSC_FOCUS_BORDER_VAR,
  VSC_LIST_ACTIVE_FOREGROUND_VAR,
  VSC_QUICK_INPUT_BACKGROUND_VAR,
  VSC_INPUT_BORDER_VAR,
  VSC_BADGE_BACKGROUND_VAR,
  VSC_BADGE_FOREGROUND_VAR,
  VSC_COMMAND_CENTER_ACTIVE_BORDER_VAR,
  VSC_COMMAND_CENTER_INACTIVE_BORDER_VAR,
  VSC_FIND_MATCH_SELECTED_VAR,
  VSC_EDITOR_LINE_NUMBER_VAR,
];

export const defaultBorderRadius = "0px";
export const lightGray = "#6e6e77";
export const greenButtonColor = "#189e72";
export const red = "#f1416c";

export const vscInputBackground = `var(${VSC_INPUT_BACKGROUND_VAR}, rgb(45 45 45))`;
export const vscQuickInputBackground = `var(${VSC_QUICK_INPUT_BACKGROUND_VAR}, ${VSC_INPUT_BACKGROUND_VAR}, rgb(45 45 45))`;
export const vscBackground = `var(${VSC_BACKGROUND_VAR}, rgb(30 30 30))`;
export const vscForeground = `var(${VSC_FOREGROUND_VAR}, #fff)`;
export const vscButtonBackground = `var(${VSC_BUTTON_BACKGROUND_VAR}, #159994)`;
export const vscButtonForeground = `var(${VSC_BUTTON_FOREGROUND_VAR}, #ffffff)`;
export const vscEditorBackground = `var(${VSC_EDITOR_BACKGROUND_VAR}, ${VSC_BACKGROUND_VAR}, rgb(30 30 30))`;
export const vscListActiveBackground = `var(${VSC_LIST_SELECTION_BACKGROUND_VAR}, #159994)`;
export const vscFocusBorder = `var(${VSC_FOCUS_BORDER_VAR}, #159994)`;
export const vscListActiveForeground = `var(${VSC_LIST_ACTIVE_FOREGROUND_VAR}, ${VSC_FOREGROUND_VAR})`;
export const vscInputBorder = `var(${VSC_INPUT_BORDER_VAR}, ${lightGray})`;
export const vscInputBorderFocus = `var(${VSC_FOCUS_BORDER_VAR}, ${lightGray})`;
export const vscBadgeBackground = `var(${VSC_BADGE_BACKGROUND_VAR}, #159994)`;
export const vscBadgeForeground = `var(${VSC_BADGE_FOREGROUND_VAR}, #ffffff)`;
export const vscCommandCenterActiveBorder = `var(${VSC_COMMAND_CENTER_ACTIVE_BORDER_VAR}, #159994)`;
export const vscCommandCenterInactiveBorder = `var(${VSC_COMMAND_CENTER_INACTIVE_BORDER_VAR}, #159994)`;
export const vscFindMatchSelected = `var(${VSC_FIND_MATCH_SELECTED_VAR}, rgba(255, 223, 0))`;
export const vscEditorLineNumber = `var(${VSC_EDITOR_LINE_NUMBER_VAR}, #6e6e77)`;

export function parseHexColor(hexColor: string): {
  r: number;
  g: number;
  b: number;
} {
  if (hexColor.startsWith("#")) {
    hexColor = hexColor.slice(1);
  }

  if (hexColor.length > 6) {
    hexColor = hexColor.slice(0, 6);
  }

  const r = parseInt(hexColor.substring(0, 2), 16);
  const g = parseInt(hexColor.substring(2, 4), 16);
  const b = parseInt(hexColor.substring(4, 6), 16);

  return { r, g, b };
}

export function parseColorForHex(colorVar: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    colorVar,
  );
  if (value.startsWith("#")) {
    return value.slice(0, 7);
  }

  // Parse rgb/rgba
  const rgbValues = value
    .slice(value.startsWith("rgba") ? 5 : 4, -1)
    .split(",")
    .map((x) => x.trim())
    .filter((_, i) => i < 3) // Only take the first 3 values (RGB, ignore alpha)
    .map((x) => parseInt(x, 10));

  let hex =
    "#" +
    rgbValues
      .map((x) => x.toString(16))
      .map((x) => (x.length === 1 ? "0" + x : x))
      .join("");

  return hex;
}

export const Button = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "py-1.5 px-3 my-2 rounded-none border-none",
      "bg-vsc-foreground text-vsc-background",
      "disabled:text-vsc-background disabled:opacity-50 disabled:pointer-events-none",
      "enabled:cursor-pointer enabled:hover:brightness-120",
      className
    )}
    {...props}
  />
);

export const SecondaryButton = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "py-1.5 px-3 m-2 rounded-none",
      "border border-vsc-input-border bg-vsc-input-background text-vsc-foreground",
      "disabled:text-gray-500",
      "enabled:cursor-pointer enabled:hover:bg-vsc-background enabled:hover:opacity-90",
      className
    )}
    {...props}
  />
);

export const GhostButton = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element => (
  <button
    className={cn(
      "py-1.5 px-2 my-1.5 rounded-none border-none",
      "bg-white/8 text-vsc-foreground",
      "disabled:text-gray-500 disabled:pointer-events-none",
      "enabled:cursor-pointer enabled:hover:brightness-125",
      className
    )}
    {...props}
  />
);

export const InputSubtext = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("text-xs leading-4 text-lightgray mt-1", className)}
    {...props}
  />
);

export const ButtonSubtext = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("block mt-0 text-center text-lightgray text-xs", className)}
    {...props}
  />
);

export const CustomScrollbarDiv = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "scrollbar-thin bg-vsc-background",
      "[&_*]:scrollbar-w-1 [&_*]:scrollbar-h-1",
      "[&_*::-webkit-scrollbar]:w-1 [&_*::-webkit-scrollbar:horizontal]:h-1",
      "[&_*::-webkit-scrollbar-thumb]:rounded-sm",
      className
    )}
    {...props}
  />
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full py-2 px-3 box-border my-1 rounded-none border border-lightgray",
        "bg-vsc-background text-vsc-foreground",
        "focus:bg-vsc-input-background focus:border-lightgray",
        "invalid:border-red",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";

export const Label = ({ 
  className, 
  fontSize,
  style,
  ...props 
}: React.LabelHTMLAttributes<HTMLLabelElement> & { fontSize?: number }) => (
  <label
    className={className}
    style={{ fontSize: `${fontSize || getFontSize()}px`, ...style }}
    {...props}
  />
);

export const HeaderButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    inverted?: boolean;
    backgroundColor?: string;
    hoverBackgroundColor?: string;
  }
>(({ 
  className,
  inverted,
  backgroundColor,
  hoverBackgroundColor,
  disabled,
  style,
  ...props 
}, ref) => (
  <button
    ref={ref}
    className={cn(
      "border-none rounded-none flex items-center justify-center gap-1 p-0.5",
      "focus:outline-none focus:border-none",
      disabled ? "cursor-default" : "cursor-pointer",
      className
    )}
    style={{
      backgroundColor: backgroundColor ?? (inverted ? `var(--vscode-editor-foreground, #fff)` : "transparent"),
      color: inverted ? `var(--vscode-sideBar-background, rgb(30 30 30))` : `var(--vscode-editor-foreground, #fff)`,
      ...style
    }}
    disabled={disabled}
    onMouseEnter={(e) => {
      if (!disabled && (typeof inverted === "undefined" || inverted)) {
        e.currentTarget.style.backgroundColor = hoverBackgroundColor ?? `var(--vscode-input-background, rgb(45 45 45))`;
      }
    }}
    onMouseLeave={(e) => {
      if (!disabled) {
        e.currentTarget.style.backgroundColor = backgroundColor ?? (inverted ? `var(--vscode-editor-foreground, #fff)` : "transparent");
      }
    }}
    {...props}
  />
));

HeaderButton.displayName = "HeaderButton";

export const StyledActionButton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex justify-between items-center cursor-pointer",
      "transition-[background-color] duration-200 rounded-none py-0.5 px-3",
      "bg-lightgray/20 hover:bg-lightgray/35",
      className
    )}
    {...props}
  />
);

export const CloseButton = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "border-none bg-inherit text-lightgray absolute top-2.5 right-4 p-1",
      "flex items-center justify-center cursor-pointer",
      className
    )}
    {...props}
  />
);

export const AnimatedEllipsis = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      "after:content-['.'] after:animate-[ellipsis_2.5s_infinite] after:inline-block after:w-3 after:text-left",
      className
    )}
    style={{
      // Keyframes are defined in the global CSS
    }}
    {...props}
  />
);
