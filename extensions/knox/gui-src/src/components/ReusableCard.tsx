import { cn } from "@/lib/utils";

import { XMarkIcon } from "../svg-icons";

import { CloseButton } from ".";

interface ReusableCardProps {
  children: React.ReactNode;
  showCloseButton?: boolean;
  onClose?: () => void;
  className?: string;
  testId?: string;
}

export function ReusableCard({
  children,
  showCloseButton,
  onClose,
  className = "",
  testId,
}: ReusableCardProps) {
  return (
    <div
      className={cn(
        "mx-auto rounded shadow-2xl relative px-2 py-3 xs:py-4 xs:px-4",
        className
      )}
      style={{
        backgroundColor: 'var(--vscode-input-background)'
      }}
      data-testid={testId}
    >
      {showCloseButton && (
        <CloseButton onClick={onClose}>
          <span className="mt-1.5 hidden h-5 w-5 hover:brightness-125 sm:flex">
            <XMarkIcon />
          </span>
        </CloseButton>
      )}
      <div className="content py-4">{children}</div>
    </div>
  );
}
