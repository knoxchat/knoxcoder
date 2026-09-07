import { ArrowLeftIcon } from "../svg-icons";
import { fontSize } from "../util";

export interface PageHeaderProps {
  onTitleClick?: () => void;
  title?: string;
  rightContent?: React.ReactNode;
  showBorder?: boolean;
}

export function PageHeader({
  onTitleClick,
  title,
  rightContent,
  showBorder,
}: PageHeaderProps) {
  return (
    <div
      className={`bg-vsc-background sticky top-0 z-20 m-0 flex items-center justify-between ${
        showBorder
          ? "border-0 border-b border-solid border-b-zinc-700"
          : ""
      }`}
    >
      {title ? (
        <div
          className="flex cursor-pointer items-center transition-colors duration-200 hover:text-zinc-100"
          onClick={onTitleClick}
        >
          <span className="ml-3 inline-block h-3 w-3">
            <ArrowLeftIcon />
          </span>
          <span
            className="mx-2 inline-block text-knoxcyan text-base font-bold"
            style={{
              fontSize: fontSize(-2),
            }}
          >
            {title}
          </span>
        </div>
      ) : (
        <div />
      )}

      {rightContent && <div className="pr-2">{rightContent}</div>}
    </div>
  );
}
