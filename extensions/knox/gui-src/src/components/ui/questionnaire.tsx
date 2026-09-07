import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type QuestionnaireChoiceData = {
  value: string;
  label: string;
  description?: string;
};

export type QuestionnaireItemData = {
  name: string;
  prompt: string;
  description?: string;
  required?: boolean;
  multiple?: boolean;
  choices?: QuestionnaireChoiceData[];
  input?: { label: string; placeholder?: string };
};

export function splitChoiceText(option: string): QuestionnaireChoiceData {
  const match = option.match(/^(.+?)\s+[—–-]\s+(.+)$/u);
  if (match) {
    return {
      value: option,
      label: match[1].trim(),
      description: match[2].trim(),
    };
  }
  return { value: option, label: option };
}

export function isQuestionnaireAnswered(
  value: string | string[] | undefined,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => item.trim().length > 0);
  }
  return typeof value === "string" && value.trim().length > 0;
}

type QuestionnaireContextValue = {
  items: QuestionnaireItemData[];
  activeItem: QuestionnaireItemData | undefined;
  activeIndex: number;
  answers: Record<string, string | string[]>;
  setChoice: (value: string) => void;
  setFreeform: (value: string) => void;
  freeformValue: string;
  selectedValues: string[];
  shortcuts: "numbers" | "letters" | false;
  disabled: boolean;
  goNext: () => void;
  goPrevious: () => void;
  isFirst: boolean;
  isLast: boolean;
  canAdvance: boolean;
  submit: () => void;
};

const QuestionnaireContext =
  React.createContext<QuestionnaireContextValue | null>(null);

function useQuestionnaire() {
  const context = React.useContext(QuestionnaireContext);
  if (!context) {
    throw new Error("Questionnaire parts must be used within <Questionnaire>");
  }
  return context;
}

function shortcutForIndex(
  index: number,
  mode: "numbers" | "letters" | false,
): string | undefined {
  if (mode === "numbers" && index < 9) {
    return String(index + 1);
  }
  if (mode === "letters" && index < 26) {
    return String.fromCharCode(97 + index);
  }
  return undefined;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function Questionnaire({
  items,
  answers,
  onAnswersChange,
  onSubmit,
  shortcuts = "numbers",
  disabled = false,
  className,
  children,
  "aria-label": ariaLabel = "Questionnaire",
}: {
  items: QuestionnaireItemData[];
  answers: Record<string, string | string[]>;
  onAnswersChange: (answers: Record<string, string | string[]>) => void;
  onSubmit: () => void;
  shortcuts?: "numbers" | "letters" | false;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const formRef = React.useRef<HTMLFormElement>(null);

  const safeIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));
  const activeItem = items[safeIndex];
  const choiceValues = activeItem?.choices?.map((choice) => choice.value) ?? [];

  const currentAnswer = activeItem ? answers[activeItem.name] : undefined;
  const selectedValues = Array.isArray(currentAnswer)
    ? currentAnswer.filter((value) => choiceValues.includes(value))
    : typeof currentAnswer === "string" && choiceValues.includes(currentAnswer)
      ? [currentAnswer]
      : [];
  const freeformValue =
    typeof currentAnswer === "string" && !choiceValues.includes(currentAnswer)
      ? currentAnswer
      : Array.isArray(currentAnswer)
        ? (currentAnswer.find((value) => !choiceValues.includes(value)) ?? "")
        : "";

  const canAdvance = activeItem
    ? activeItem.required === false || isQuestionnaireAnswered(currentAnswer)
    : false;

  const writeAnswer = React.useCallback(
    (name: string, value: string | string[]) => {
      onAnswersChange({ ...answers, [name]: value });
    },
    [answers, onAnswersChange],
  );

  const setChoice = React.useCallback(
    (value: string) => {
      if (!activeItem || disabled) {
        return;
      }
      if (activeItem.multiple) {
        const next = selectedValues.includes(value)
          ? selectedValues.filter((item) => item !== value)
          : [...selectedValues, value];
        const extras = freeformValue.trim() ? [freeformValue.trim()] : [];
        writeAnswer(activeItem.name, [...next, ...extras]);
        return;
      }
      writeAnswer(activeItem.name, value);
    },
    [activeItem, disabled, freeformValue, selectedValues, writeAnswer],
  );

  const setFreeform = React.useCallback(
    (value: string) => {
      if (!activeItem || disabled) {
        return;
      }
      if (activeItem.multiple) {
        const extras = value.trim() ? [value] : [];
        writeAnswer(activeItem.name, [...selectedValues, ...extras]);
        return;
      }
      writeAnswer(activeItem.name, value);
    },
    [activeItem, disabled, selectedValues, writeAnswer],
  );

  const goNext = React.useCallback(() => {
    if (!canAdvance || safeIndex >= items.length - 1) {
      return;
    }
    setActiveIndex((index) => Math.min(index + 1, items.length - 1));
  }, [canAdvance, items.length, safeIndex]);

  const goPrevious = React.useCallback(() => {
    setActiveIndex((index) => Math.max(index - 1, 0));
  }, []);

  const submit = React.useCallback(() => {
    if (!canAdvance || safeIndex < items.length - 1 || disabled) {
      return;
    }
    onSubmit();
  }, [canAdvance, disabled, items.length, onSubmit, safeIndex]);

  React.useEffect(() => {
    if (!disabled) {
      formRef.current?.focus();
    }
  }, [disabled, safeIndex]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (disabled || !activeItem) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      if (isTypingTarget(event.target) && !canAdvance) {
        return;
      }
      event.preventDefault();
      if (safeIndex < items.length - 1) {
        goNext();
      } else {
        submit();
      }
      return;
    }
    if (isTypingTarget(event.target) || !shortcuts) {
      return;
    }
    const key = event.key.toLowerCase();
    const index =
      shortcuts === "numbers"
        ? Number(key) - 1
        : key.length === 1
          ? key.charCodeAt(0) - 97
          : -1;
    const choice = activeItem.choices?.[index];
    if (choice) {
      event.preventDefault();
      setChoice(choice.value);
    }
  };

  const context: QuestionnaireContextValue = {
    items,
    activeItem,
    activeIndex: safeIndex,
    answers,
    setChoice,
    setFreeform,
    freeformValue,
    selectedValues,
    shortcuts,
    disabled,
    goNext,
    goPrevious,
    isFirst: safeIndex === 0,
    isLast: safeIndex >= items.length - 1,
    canAdvance,
    submit,
  };

  return (
    <QuestionnaireContext.Provider value={context}>
      <form
        ref={formRef}
        tabIndex={-1}
        aria-label={ariaLabel}
        className={cn("outline-none", className)}
        onSubmit={(event) => {
          event.preventDefault();
          if (safeIndex < items.length - 1) {
            goNext();
          } else {
            submit();
          }
        }}
        onKeyDown={onKeyDown}
      >
        {children}
      </form>
    </QuestionnaireContext.Provider>
  );
}

export function QuestionnaireProgress({
  className,
  children,
}: {
  className?: string;
  children?: (state: { current: number; total: number }) => React.ReactNode;
}) {
  const { items, activeIndex } = useQuestionnaire();
  if (items.length < 2) {
    return null;
  }
  const current = activeIndex + 1;
  const total = items.length;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {children?.({ current, total }) ?? `Question ${current} of ${total}`}
        </span>
      </div>
      <Progress value={(current / total) * 100} className="h-1" />
    </div>
  );
}

export function QuestionnaireItem({
  name,
  className,
  children,
}: {
  name: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { activeItem } = useQuestionnaire();
  if (activeItem?.name !== name) {
    return null;
  }
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-3 border-0 p-0", className)}>
      {children}
    </fieldset>
  );
}

export function QuestionnaireTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLLegendElement>) {
  return (
    <legend
      className={cn(
        "text-sm font-semibold leading-snug tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

export function QuestionnaireDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-xs leading-snug text-muted-foreground", className)}
      {...props}
    />
  );
}

export function QuestionnaireChoices({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { activeItem, selectedValues, setChoice, disabled } = useQuestionnaire();
  const multiple = activeItem?.multiple === true;
  const body = (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      {children}
    </div>
  );
  if (multiple || !activeItem?.choices?.length) {
    return body;
  }
  return (
    <RadioGroup
      value={selectedValues[0] ?? ""}
      onValueChange={setChoice}
      disabled={disabled}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {children}
    </RadioGroup>
  );
}

export function QuestionnaireChoice({
  value,
  label,
  description,
  shortcut,
}: {
  value: string;
  label: string;
  description?: string;
  shortcut?: string;
}) {
  const { activeItem, selectedValues, setChoice, disabled, shortcuts } =
    useQuestionnaire();
  const multiple = activeItem?.multiple === true;
  const selected = selectedValues.includes(value);
  const resolvedShortcut =
    shortcut ??
    shortcutForIndex(
      activeItem?.choices?.findIndex((choice) => choice.value === value) ?? -1,
      shortcuts,
    );

  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10 shadow-sm"
          : "border-border bg-background/30 hover:border-primary/40 hover:bg-accent/40",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      {multiple ? (
        <Checkbox
          checked={selected}
          disabled={disabled}
          onCheckedChange={() => setChoice(value)}
          className="mt-0.5"
          aria-label={label}
        />
      ) : (
        <RadioGroupItem
          value={value}
          disabled={disabled}
          aria-label={label}
          className="mt-0.5"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {resolvedShortcut ? (
        <kbd className="mt-0.5 shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
          {resolvedShortcut}
        </kbd>
      ) : null}
    </label>
  );
}

export function QuestionnaireInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  const { freeformValue, setFreeform, disabled, activeItem } =
    useQuestionnaire();
  return (
    <Input
      value={freeformValue}
      disabled={disabled}
      onChange={(event) => setFreeform(event.target.value)}
      aria-label={activeItem?.input?.label ?? props["aria-label"]}
      className={cn("h-8 bg-background text-sm", className)}
      {...props}
    />
  );
}

export function QuestionnaireActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props} />
  );
}

export function QuestionnairePrevious({
  children,
  ...props
}: ButtonProps) {
  const { goPrevious, isFirst, disabled } = useQuestionnaire();
  if (isFirst) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={goPrevious}
      {...props}
    >
      {children}
    </Button>
  );
}

export function QuestionnaireNext({ children, ...props }: ButtonProps) {
  const { goNext, isLast, canAdvance, disabled } = useQuestionnaire();
  if (isLast) {
    return null;
  }
  return (
    <Button
      type="button"
      size="sm"
      disabled={disabled || !canAdvance}
      onClick={goNext}
      {...props}
    >
      {children}
    </Button>
  );
}

export function QuestionnaireSubmit({ children, ...props }: ButtonProps) {
  const { submit, isLast, canAdvance, disabled } = useQuestionnaire();
  if (!isLast) {
    return null;
  }
  return (
    <Button
      type="button"
      size="sm"
      disabled={disabled || !canAdvance}
      onClick={submit}
      {...props}
    >
      {children}
    </Button>
  );
}
