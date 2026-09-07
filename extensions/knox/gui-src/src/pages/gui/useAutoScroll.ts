import { useEffect, useState, useRef, useCallback } from "react";

import { useScrollContext } from "../../contexts/ScrollContext";

export const useAutoScroll = (
  ref: React.RefObject<HTMLDivElement>,
  history: unknown[],
  _isAgentMode: boolean = false
) => {
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const lastHistoryLength = useRef<number>(0);
  const lastScrollHeight = useRef<number>(0);
  const isScrollingRef = useRef<boolean>(false);
  const contentObserverRef = useRef<MutationObserver | null>(null);
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
  const rafRef = useRef<number | null>(null);
  
  // Use the global scroll context
  const { 
    setUserHasScrolled, 
    isGenerating, 
    setIsGenerating  } = useScrollContext();
  
  // Simple check if user is at bottom
  const isAtBottom = useCallback(() => {
    if (!ref.current) {return true;}
    
    const { scrollTop, scrollHeight, clientHeight } = ref.current;
    // More generous threshold - if within 50px of bottom, consider at bottom
    return Math.abs(scrollHeight - scrollTop - clientHeight) < 50;
  }, [ref]);
  
  // Simple scroll to bottom function
  const scrollToBottom = useCallback((force: boolean = false) => {
    if (!ref.current) {return;}
    
    // Don't auto-scroll if user has manually scrolled up, unless forced
    if (!force && isUserScrolledUp) {return;}
    
    isScrollingRef.current = true;
    
    // Use smooth scrolling like Cursor for better UX
    ref.current.scrollTo({
      top: ref.current.scrollHeight,
      behavior: 'smooth'
    });
    
    // Reset scroll state when we scroll to bottom
    setIsUserScrolledUp(false);
    setUserHasScrolled(false);
    
    setTimeout(() => {
      isScrollingRef.current = false;
    }, 300); // Increased timeout for smooth scroll completion
  }, [ref, isUserScrolledUp, setUserHasScrolled]);
  
  // Handle scroll events - simple detection
  useEffect(() => {
    if (!ref.current) {return;}
    
    const handleScroll = () => {
      // Ignore programmatic scrolls
      if (isScrollingRef.current) {return;}
      
      const atBottom = isAtBottom();
      
      if (!atBottom && !isUserScrolledUp) {
        // User scrolled up
        setIsUserScrolledUp(true);
        setUserHasScrolled(true);
      } else if (atBottom && isUserScrolledUp) {
        // User scrolled back to bottom
        setIsUserScrolledUp(false);
        setUserHasScrolled(false);
      }
    };
    
    ref.current.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      ref.current?.removeEventListener('scroll', handleScroll);
    };
  }, [ref, isAtBottom, isUserScrolledUp, setUserHasScrolled]);
  
  // Enhanced scroll detection with Intersection Observer for scroll sentinel
  useEffect(() => {
    if (!ref.current) {return;}
    
    const scrollSentinel = document.getElementById('scroll-sentinel');
    if (!scrollSentinel) {return;}
    
    // Set up intersection observer for scroll sentinel
    intersectionObserverRef.current = new IntersectionObserver((entries) => {
      const isAtBottom = entries[0].isIntersecting;
      
      if (isAtBottom && isUserScrolledUp) {
        // User scrolled back to bottom
        setIsUserScrolledUp(false);
        setUserHasScrolled(false);
      }
    }, {
      root: ref.current,
      threshold: 0.1
    });
    
    intersectionObserverRef.current.observe(scrollSentinel);
    
    return () => {
      intersectionObserverRef.current?.disconnect();
    };
  }, [ref, isUserScrolledUp, setUserHasScrolled]);
  
  // Enhanced content observation for code generation
  useEffect(() => {
    if (!ref.current) {return;}
    
    // Set up mutation observer to watch for content changes
    contentObserverRef.current = new MutationObserver((mutations) => {
      // During generation, always auto-scroll unless user has manually scrolled up
      if (isGenerating && !isUserScrolledUp) {
        let shouldScroll = false;
        let isCodeBlockUpdate = false;
        
        mutations.forEach((mutation) => {
          // Check for any content changes during generation
          if (mutation.type === 'childList' || mutation.type === 'characterData') {
            shouldScroll = true;
            
            // Check if this is within a code block
            // mutation.target can be a text node, so we need to check if it's an Element first
            const target = mutation.target;
            if (target instanceof Element) {
              if (target.closest('pre') || target.closest('code') || 
                  target.classList?.contains('code-block-placeholder')) {
                isCodeBlockUpdate = true;
              }
            } else if (target.parentElement) {
              // For text nodes, check parent element
              if (target.parentElement.closest('pre') || target.parentElement.closest('code')) {
                isCodeBlockUpdate = true;
              }
            }
          }
          
          // Also check for attribute changes on code blocks
          if (mutation.type === 'attributes' && 
              (mutation.attributeName === 'data-isgeneratingcodeblock' ||
               mutation.attributeName === 'data-codeblockcontent' ||
               mutation.attributeName === 'data-relativefilepath')) {
            shouldScroll = true;
            isCodeBlockUpdate = true;
          }
        });
        
        if (shouldScroll) {
          // Always scroll during generation, regardless of bottom position
          // Use requestAnimationFrame for better performance like Cursor
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
          }
          
          rafRef.current = requestAnimationFrame(() => {
            if (isGenerating && !isUserScrolledUp) {
              // For code block updates, ensure we scroll to the very bottom
              // For text updates, use normal scrolling
              if (isCodeBlockUpdate && ref.current) {
                // Instant scroll to bottom for code blocks to keep up with streaming
                ref.current.scrollTop = ref.current.scrollHeight;
              } else {
                scrollToBottom();
              }
            }
            rafRef.current = null;
          });
        }
      }
    });
    
    // Observe the entire container with subtree and attributes
    contentObserverRef.current.observe(ref.current, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-isgeneratingcodeblock', 'data-codeblockcontent', 'data-relativefilepath', 'class']
    });
    
    return () => {
      contentObserverRef.current?.disconnect();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [ref, isUserScrolledUp, isGenerating, scrollToBottom]);
  
  // Auto-scroll when new content is added during generation
  useEffect(() => {
    if (!ref.current) {return;}
    
    const currentScrollHeight = ref.current.scrollHeight;
    const hasNewContent = currentScrollHeight > lastScrollHeight.current;
    const hasNewMessage = history.length > lastHistoryLength.current;
    
    // Update refs
    lastScrollHeight.current = currentScrollHeight;
    lastHistoryLength.current = history.length;
    
    // During generation, always auto-scroll if user hasn't manually interrupted
    if (isGenerating && (hasNewContent || hasNewMessage) && !isUserScrolledUp) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      
      rafRef.current = requestAnimationFrame(() => {
        scrollToBottom();
        rafRef.current = null;
      });
    }
    // For new messages (like follow-up questions), scroll to bottom even if not generating yet
    else if (hasNewMessage && !isUserScrolledUp) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      
      rafRef.current = requestAnimationFrame(() => {
        scrollToBottom();
        rafRef.current = null;
      });
    }
    // For non-generation content, only scroll if at bottom
    else if (!isGenerating && hasNewContent && !isUserScrolledUp && isAtBottom()) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      
      rafRef.current = requestAnimationFrame(() => {
        scrollToBottom();
        rafRef.current = null;
      });
    }
  }, [history.length, scrollToBottom, isUserScrolledUp, isAtBottom, isGenerating]);
  
  // Reset scroll state when starting a new session
  useEffect(() => {
    if (history.length === 0) {
      setIsUserScrolledUp(false);
      setUserHasScrolled(false);
      setIsGenerating(false);
    }
  }, [history.length, setUserHasScrolled, setIsGenerating]);
  
  // Expose methods that can be used by the parent component
  return {
    scrollToBottom: (force = false) => {
      scrollToBottom(force);
    },
    isAutoScrolling: !isUserScrolledUp,
    isGenerating,
    updateStreamingState: (streaming: boolean) => {
      setIsGenerating(streaming);
    }
  };
};
