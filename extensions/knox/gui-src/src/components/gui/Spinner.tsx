import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: string;
  color?: string;
  thickness?: string;
  speed?: string;
  centerInParent?: boolean;
}

const Spinner: React.FC<SpinnerProps> = ({
  size = "16px",
  color = "#159994",
  thickness = "2px",
  speed = "0.8s",
  centerInParent = false
}) => {
  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes pulseOpacity {
            0% { opacity: 0.6; }
            50% { opacity: 1; }
            100% { opacity: 0.6; }
          }
        `
      }} />
      <div
        className={cn(
          "inline-flex items-center justify-center",
          "animate-[pulseOpacity_2s_infinite_ease-in-out]",
          centerInParent && "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        )}
        style={{ width: size, height: size }}
      >
        <div 
          className="rounded-full animate-spin"
          style={{
            width: size,
            height: size,
            border: `${thickness} solid rgba(255, 255, 255, 0.1)`,
            borderTop: `${thickness} solid ${color}`,
            animationDuration: speed
          }}
        />
      </div>
    </>
  );
};

export default Spinner;
