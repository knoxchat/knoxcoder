import { JSONContent } from "@tiptap/react";
import { useState, useEffect } from "react";

import { getLocalStorage, setLocalStorage } from "../util/localStorage";

import useUpdatingRef from "./useUpdatingRef";

const emptyJsonContent = () => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
});

const MAX_HISTORY_LENGTH = 100;

export function useInputHistory(historyKey: string) {
  const [inputHistory, setInputHistory] = useState<JSONContent[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [pendingInput, setPendingInput] =
    useState<JSONContent>(emptyJsonContent());
  const [currentIndex, setCurrentIndex] = useState(0);

  // Load input history from IndexedDB on mount
  useEffect(() => {
    let mounted = true;

    async function loadHistory() {
      try {
        const history = await getLocalStorage(`inputHistory_${historyKey}` as any);
        if (mounted) {
          const historyArray = (history || []).slice(-MAX_HISTORY_LENGTH);
          setInputHistory(historyArray);
          setCurrentIndex(historyArray.length);
          setIsLoaded(true);
        }
      } catch (error) {
        console.error("Error loading input history:", error);
        if (mounted) {
          setInputHistory([]);
          setCurrentIndex(0);
          setIsLoaded(true);
        }
      }
    }

    loadHistory();

    return () => {
      mounted = false;
    };
  }, [historyKey]);

  function prev(currentInput: JSONContent) {
    if (!isLoaded) return;
    
    let index = currentIndex;

    if (index === inputHistory.length) {
      setPendingInput(currentInput);
    }

    if (index > 0 && index <= inputHistory.length) {
      setCurrentIndex((prevState) => prevState - 1);
      return inputHistory[index - 1];
    }
  }

  function next() {
    if (!isLoaded) return;
    
    let index = currentIndex;
    if (index >= 0 && index < inputHistory.length) {
      setCurrentIndex((prevState) => prevState + 1);
      if (index === inputHistory.length - 1) {
        return pendingInput;
      }
      return inputHistory[index + 1];
    }
  }

  function add(inputValue: JSONContent) {
    if (!isLoaded) return;
    
    setPendingInput(emptyJsonContent());

    if (
      JSON.stringify(inputHistory[inputHistory.length - 1]) ===
      JSON.stringify(inputValue)
    ) {
      setCurrentIndex(inputHistory.length);
      return;
    }

    setCurrentIndex(inputHistory.length + 1);
    const newHistory = [...inputHistory, inputValue].slice(-MAX_HISTORY_LENGTH);
    setInputHistory(newHistory);
    
    // Save to IndexedDB asynchronously
    setLocalStorage(`inputHistory_${historyKey}` as any, newHistory).catch(
      (error) => {
        console.error("Error saving input history:", error);
      }
    );
  }

  const prevRef = useUpdatingRef(prev, [inputHistory, isLoaded]);
  const nextRef = useUpdatingRef(next, [inputHistory, isLoaded]);
  const addRef = useUpdatingRef(add, [inputHistory, isLoaded]);

  return { prevRef, nextRef, addRef };
}
