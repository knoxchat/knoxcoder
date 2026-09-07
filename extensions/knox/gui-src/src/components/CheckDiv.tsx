import { cn } from "@/lib/utils";

import CheckIcon from "../svg-icons/checkIcon";

interface CheckDivProps {
  title: string;
  checked: boolean;
  onClick: () => void;
}

function CheckDiv(props: CheckDivProps) {
  const { title, checked, onClick } = props;

  return (
    <div 
      onClick={onClick}
      className={cn(
        "flex flex-row items-center justify-center p-2 rounded cursor-pointer",
        "border w-fit m-2 h-[1.4em] overflow-hidden text-ellipsis",
        "transition-colors",
        "hover:brightness-150"
      )}
      style={{
        borderColor: 'var(--vscode-foreground)',
        color: 'var(--vscode-foreground)',
        backgroundColor: 'var(--vscode-background)'
      }}
    >
      {checked && <CheckIcon />}
      {title}
    </div>
  );
}

export default CheckDiv;
