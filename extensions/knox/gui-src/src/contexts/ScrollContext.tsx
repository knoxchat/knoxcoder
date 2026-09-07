import React, { createContext, useContext, useState, useRef, useCallback } from 'react';

interface ScrollContextType {
  userHasScrolled: boolean;
  setUserHasScrolled: (value: boolean) => void;
  isGenerating: boolean;
  setIsGenerating: (value: boolean) => void;
  scrollToBottom: () => void;
  resetScrollState: () => void;
  registerScrollContainer: (ref: React.RefObject<HTMLDivElement>) => void;
}

const ScrollContext = createContext<ScrollContextType>({
  userHasScrolled: false,
  setUserHasScrolled: () => {},
  isGenerating: false,
  setIsGenerating: () => {},
  scrollToBottom: () => {},
  resetScrollState: () => {},
  registerScrollContainer: () => {},
});

export const useScrollContext = () => useContext(ScrollContext);

export const ScrollProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const scrollContainerRef = useRef<React.RefObject<HTMLDivElement> | null>(null);
  
  const registerScrollContainer = useCallback((ref: React.RefObject<HTMLDivElement>) => {
    scrollContainerRef.current = ref;
  }, []);
  
  // Enhanced scroll to bottom function
  const scrollToBottom = useCallback(() => {
    // Reset user scrolled state when explicitly scrolling to bottom
    setUserHasScrolled(false);
    
    // Actually scroll the container if we have a reference
    if (scrollContainerRef.current?.current) {
      // Use smooth scrolling like Cursor
      scrollContainerRef.current.current.scrollTo({
        top: scrollContainerRef.current.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, []);
  
  const resetScrollState = useCallback(() => {
    setUserHasScrolled(false);
    setIsGenerating(false);
  }, []);
  
  const value = {
    userHasScrolled,
    setUserHasScrolled,
    isGenerating,
    setIsGenerating,
    scrollToBottom,
    resetScrollState,
    registerScrollContainer,
  };
  
  return <ScrollContext.Provider value={value}>{children}</ScrollContext.Provider>;
};
