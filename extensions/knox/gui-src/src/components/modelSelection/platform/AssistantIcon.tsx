import { Monitor, Sparkles } from "lucide-react";
import { ProfileDescription } from "core/config/ProfileLifecycleManager";

import { isLocalProfile } from "../../../util";

export interface AssistantIconProps {
  assistant: ProfileDescription;
  size?: number;
}

export default function AssistantIcon({ assistant, size }: AssistantIconProps) {
  const sizeTw = size ?? 4;
  if (isLocalProfile(assistant)) {
    return <Monitor className={`h-${sizeTw} w-${sizeTw} text-knoxcyan`} />;
  } else if (assistant.iconUrl) {
    return (
      <img
        src={assistant.iconUrl}
        className={`h-${sizeTw} w-${sizeTw} rounded-full`}
        alt=""
      />
    );
  } else {
    return <Sparkles className="text-knoxcyan" />;
  }
}
