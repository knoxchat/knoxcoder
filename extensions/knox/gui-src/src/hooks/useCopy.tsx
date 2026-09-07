import { useState, useContext, useCallback } from "react";

import { IdeMessengerContext } from "../context/IdeMessenger";

export default function useCopy(text: string | (() => string)) {
  const [copied, setCopied] = useState<boolean>(false);
  const ideMessenger = useContext(IdeMessengerContext);

  const copyText = useCallback(() => {
    const textVal = typeof text === "string" ? text : text();
    
    navigator.clipboard.writeText(textVal);

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text, ideMessenger]);

  return { copied, copyText };
}
