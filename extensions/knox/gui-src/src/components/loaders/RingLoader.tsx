import { cn } from "@/lib/utils";

const RingLoader = (props: {
  size: number;
  wFull?: boolean;
  className?: string;
  width?: string;
  height?: string;
  period?: number;
}) => {
  const viewBox = `0 0 ${props.size} ${props.size}`;
  const size = (props.size / 2).toString();
  const r = "14"; //(props.size / 2 - 2).toString();
  const period = props.period || 6;
  
  return (
    <div
      className={cn(
        "m-auto mt-2 text-center",
        props.wFull !== false && "w-full",
        props.className
      )}
    >
      <svg
        className="opacity-50"
        style={{
          transform: 'rotate(-90deg)',
          width: props.width || "40px",
          height: props.height || "40px"
        }}
        viewBox={viewBox}
      >
        <circle 
          cx={size} 
          cy={size} 
          r={r}
          className="fill-none animate-rotate"
          style={{
            stroke: 'var(--vscode-foreground)',
            strokeWidth: 2,
            strokeDasharray: 100,
            strokeDashoffset: 0,
            strokeLinecap: 'round' as const,
            animationDuration: `${period}s`
          }}
        />
      </svg>
    </div>
  );
};

export default RingLoader;
