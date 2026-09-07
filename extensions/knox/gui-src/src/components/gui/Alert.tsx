import { ReactNode } from "react";

import {
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  CheckIcon,
} from "../../svg-icons";

type AlertTypes = "info" | "success" | "warning" | "error";

export interface AlertProps {
  children?: ReactNode;
  type?: AlertTypes;
}

type AlertConfig = {
  [key in AlertTypes]: {
    Icon: any;
    borderColor: string;
    backgroundColor: string;
  };
};

const ALERT_CONFIGS: AlertConfig = {
  info: {
    Icon: InformationCircleIcon,
    borderColor: "#0dcaf0",
    backgroundColor: "rgba(13, 202, 240, 0.1)",
  },
  success: {
    Icon: CheckIcon,
    borderColor: "#50cd89",
    backgroundColor: "rgba(80, 205, 137, 0.1)",
  },
  warning: {
    Icon: ExclamationTriangleIcon,
    borderColor: "#ffc700",
    backgroundColor: "rgba(255, 199, 0, 0.1)",
  },
  error: {
    Icon: ExclamationCircleIcon,
    borderColor: "#f1416c",
    backgroundColor: "rgba(241, 65, 108, 0.1)",
  },
};

function Alert({ children, type = "info" }: AlertProps) {
  const { Icon, borderColor, backgroundColor } = ALERT_CONFIGS[type];

  return (
    <div 
      className="rounded p-4 shadow-none"
      style={{
        borderLeft: `4px solid ${borderColor}`,
        backgroundColor: backgroundColor
      }}
    >
      <div className="flex items-start">
        <div 
          className="h-6 min-h-5 w-6 min-w-5 flex-shrink-0"
          style={{ color: borderColor }}
        >
          <Icon />
        </div>
        <div 
          className="ml-3"
          style={{ color: 'var(--vscode-foreground)' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default Alert;
