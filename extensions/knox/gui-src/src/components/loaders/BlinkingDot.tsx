import { cn } from "@/lib/utils";

const DEFAULT_DIAMETER = 6;

interface BlinkingDotProps {
  color: string;
  diameter?: number;
  shouldBlink?: boolean;
  className?: string;
}

const BlinkingDot = ({ color, diameter = DEFAULT_DIAMETER, shouldBlink = false, className }: BlinkingDotProps) => {
  return (
    <div
      className={cn(
        "rounded-full border border-white/75 mx-[2px]",
        shouldBlink && "animate-blink",
        className
      )}
      style={{
        backgroundColor: color,
        boxShadow: `0px 0px 2px 1px ${color}`,
        width: `${diameter}px`,
        height: `${diameter}px`,
      }}
    />
  );
};

export default BlinkingDot;
