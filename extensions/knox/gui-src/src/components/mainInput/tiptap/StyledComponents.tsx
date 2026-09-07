import { cn } from "@/lib/utils";
import { getFontSize } from "../../../util";

export const InputBoxDiv = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "resize-none font-inherit rounded-none pb-px m-0 h-auto w-full",
      "bg-vsc-input-background text-vsc-foreground",
      "border-0 border-vsc-input-border transition-[border-color] duration-150 ease-in-out",
      "focus-within:border focus-within:border-list-active",
      "outline-none focus:outline-none focus:border-[0.5px] focus:border-list-active",
      "placeholder:text-lightgray/80",
      "flex flex-col",
      className
    )}
    style={{ fontSize: `${getFontSize()}px` }}
    {...props}
  />
);

export const HoverDiv = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "absolute w-full h-full top-0 left-0 opacity-50",
      "bg-[var(--vscode-badge-background,#159994)]",
      "text-vsc-foreground flex items-center justify-center",
      className
    )}
    {...props}
  />
);

export const HoverTextDiv = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "absolute w-full h-full top-0 left-0",
      "text-vsc-foreground flex items-center justify-center",
      className
    )}
    {...props}
  />
);
