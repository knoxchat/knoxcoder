import React, { useRef } from "react";
import { cn } from "@/lib/utils";

type CustomSwitchProps = {
  isToggled: boolean;
  onToggle: () => void;
  text?: string;
  size?: number;
  disabled?: boolean;
  className?: string;
};

const CustomSwitch: React.FC<CustomSwitchProps> = ({
  isToggled,
  onToggle,
  text,
  size = 16,
  disabled = false,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const handleClick = () => {
    if (!disabled) {
      onToggle();
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onToggle();
    }
  };

  const trackWidth = size * 2;
  const trackHeight = size;
  const thumbSize = size - 4;

  return (
    <div 
      className={cn(
        "flex items-center justify-between gap-3 px-1.5 py-1 rounded min-h-[28px]",
        "transition-colors duration-200 select-none",
        !disabled && "cursor-pointer hover:bg-vsc-input-background/30",
        "focus-visible:outline-2 focus-visible:outline-knoxcyan/50 focus-visible:outline-offset-2",
        disabled && "opacity-60 cursor-not-allowed",
        className
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={disabled ? -1 : 0}
      role="switch"
      aria-checked={isToggled}
      ref={containerRef}
    >
      {text && (
        <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[13px] leading-tight text-vsc-foreground">
          {text}
        </span>
      )}
      
      {/* Switch Track */}
      <div 
        className="relative rounded-full transition-all duration-200 ease-in-out shrink-0 flex items-center p-0 shadow-inner"
        style={{
          width: `${trackWidth}px`,
          height: `${trackHeight}px`,
          backgroundColor: isToggled 
            ? (disabled ? 'rgba(21, 153, 148, 0.3)' : '#159994')
            : 'var(--vscode-input-background, rgba(120, 120, 120, 0.3))',
          boxShadow: 'inset 0 1px 1px rgba(0, 0, 0, 0.1)',
        }}
      >
        {/* Switch Thumb */}
        <div
          className="relative rounded-full transition-transform duration-200 ease-in-out shadow-sm mx-0.5"
          style={{
            width: `${thumbSize}px`,
            height: `${thumbSize}px`,
            backgroundColor: isToggled 
              ? '#ffffff'
              : 'var(--vscode-descriptionForeground, #9e9e9e)',
            transform: isToggled ? `translateX(${thumbSize + 4}px)` : 'translateX(0)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
          }}
        />
      </div>
    </div>
  );
};

export default CustomSwitch;

