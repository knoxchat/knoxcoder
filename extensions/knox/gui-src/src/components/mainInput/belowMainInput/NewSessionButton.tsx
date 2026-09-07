import { getFontSize } from "../../../util";
import { lightGray } from "../..";

interface NewSessionButtonProps {
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export const NewSessionButton = ({ children, onClick, className }: NewSessionButtonProps) => {
  return (
    <div
      className={`w-fit mr-auto ml-1.5 mt-0.5 mb-2 rounded px-1.5 py-0.5 cursor-pointer hover:text-[var(--vscode-foreground)] ${className || ''}`}
      style={{
        fontSize: `${getFontSize() - 2}px`,
        color: lightGray
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = `${lightGray}33`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
