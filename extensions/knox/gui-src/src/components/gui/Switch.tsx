import React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ToggleSwitchProps = {
  isToggled: boolean;
  onToggle: () => void;
  text: string;
  size?: number;
  disabled?: boolean;
};

/**
 * Standard Toggle Switch using shadcn/ui Switch component
 * For smaller, animated switches, use CustomSwitch instead
 */
const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  isToggled,
  onToggle,
  text,
  size = 16,
  disabled = false,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div 
      className={cn(
        "flex items-center justify-between gap-3 px-2 py-1.5 rounded-md min-h-[32px]",
        "transition-all duration-200 select-none cursor-pointer group",
        !disabled && "hover:bg-vsc-input-background/50",
        "focus-visible:outline-2 focus-visible:outline-knoxcyan/50 focus-visible:outline-offset-2",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={() => !disabled && onToggle()}
      onKeyDown={handleKeyDown}
      tabIndex={disabled ? -1 : 0}
      role="switch"
      aria-checked={isToggled}
    >
      {text && (
        <Label 
          htmlFor={`switch-${text}`}
          className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[13px] leading-tight cursor-pointer font-medium text-vsc-foreground"
        >
          {text}
        </Label>
      )}
      <Switch 
        id={`switch-${text}`}
        checked={isToggled}
        onCheckedChange={onToggle}
        disabled={disabled}
        className={cn(
          size && size !== 16 && `scale-[${size / 16}]`
        )}
      />
    </div>
  );
};

export default ToggleSwitch;
