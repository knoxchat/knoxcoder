interface HoverItemProps {
  isActive?: boolean;
  px?: number;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

const HoverItem = ({ isActive, px = 4, children, className, onClick }: HoverItemProps) => {
  return (
    <span
      className={`pt-0.5 pb-0.5 cursor-pointer transition-all duration-200 ${className || ''}`}
      style={{ padding: `0 ${px}px`, paddingTop: '2px', paddingBottom: '2px' }}
      onClick={onClick}
    >
      {children}
    </span>
  );
};

export default HoverItem;
