import { useState } from "react";

export default function useIsOSREnabled() {
  const [isOSREnabled, setIsOSREnabled] = useState(false);

  return isOSREnabled;
}
