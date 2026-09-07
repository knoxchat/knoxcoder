import React, { useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => {
  const [isFocused, setIsFocused] = useState(false);
  
  const handleFocus = useCallback((e: React.FocusEvent<HTMLSelectElement>) => {
    setIsFocused(true);
    if (props.onFocus) {
      props.onFocus(e);
    }
  }, [props.onFocus]);
  
  const handleBlur = useCallback((e: React.FocusEvent<HTMLSelectElement>) => {
    setIsFocused(false);
    if (props.onBlur) {
      props.onBlur(e);
    }
  }, [props.onBlur]);
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    if (props.onChange) {
      props.onChange(e);
    }
  }, [props.onChange]);
  
  // Clone props to make sure we don't override key handlers
  const selectProps = { ...props };
  delete selectProps.onFocus;
  delete selectProps.onBlur;
  delete selectProps.onChange;
  
  return (
    <div 
      className={cn(
        "relative inline-block w-auto min-w-[90px] transition-all duration-200",
        isFocused && "animate-[focus-pulse_2s_ease-in-out_infinite]"
      )}
    >
      <div className={cn(
        "relative flex items-center rounded border overflow-hidden",
        "bg-accent/20 border-border shadow-sm transition-all duration-200",
        "hover:bg-accent/30 hover:shadow-md",
        "dark:bg-accent/20 dark:border-border",
        "dark:hover:bg-accent/30"
      )}>
        <select
          {...selectProps}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            "appearance-none w-full text-[13px] bg-transparent border-none",
            "text-foreground py-1.5 pr-7 pl-2.5 cursor-pointer outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {props.children}
        </select>
        <div className={cn(
          "absolute top-0 right-0 h-full flex items-center justify-center px-2 pointer-events-none",
          "text-primary/80"
        )}>
          <ChevronDown 
            className={cn(
              "w-2.5 h-2.5 transition-transform duration-200",
              isFocused && "animate-[arrow-bounce_1.5s_ease-in-out_infinite]"
            )}
          />
        </div>
      </div>
    </div>
  );
};
