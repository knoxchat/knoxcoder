import React, { createContext, useContext, useEffect, useState } from "react";

import {
  getLocalStorage,
  LOCAL_STORAGE_CHANGED_EVENT,
} from "../util/localStorage";

interface LocalStorageType {
  fontSize: number;
}

const DEFAULT_LOCAL_STORAGE: LocalStorageType = {
  fontSize: 14,
};

const LocalStorageContext = createContext<LocalStorageType>(
  DEFAULT_LOCAL_STORAGE,
);

function applyFontSize(fontSize: number) {
  document.documentElement.style.fontSize = `${fontSize}px`;
  document.documentElement.style.setProperty("--font-size-base", `${fontSize}px`);
  document.body.style.fontSize = `${fontSize}px`;
}

export const LocalStorageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [values, setValues] = useState<LocalStorageType>(DEFAULT_LOCAL_STORAGE);

  useEffect(() => {
    let isMounted = true;
    let hasReceivedStorageChange = false;

    const setFontSize = (fontSize: number) => {
      applyFontSize(fontSize);
      setValues((current) => ({ ...current, fontSize }));
    };

    getLocalStorage("fontSize").then((storedFontSize) => {
      if (!isMounted || hasReceivedStorageChange) {
        return;
      }

      setFontSize(storedFontSize ?? DEFAULT_LOCAL_STORAGE.fontSize);
    });

    const handleStorageChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      if (detail?.key === "fontSize" && typeof detail.value === "number") {
        hasReceivedStorageChange = true;
        setFontSize(detail.value);
      }
    };

    window.addEventListener(LOCAL_STORAGE_CHANGED_EVENT, handleStorageChange);

    return () => {
      isMounted = false;
      window.removeEventListener(LOCAL_STORAGE_CHANGED_EVENT, handleStorageChange);
    };
  }, []);

  return (
    <LocalStorageContext.Provider value={values}>
      {children}
    </LocalStorageContext.Provider>
  );
};

export const useLocalStorage = () => {
  const context = useContext(LocalStorageContext);
  return context;
};
