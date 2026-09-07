import { useState, useEffect, useRef, useCallback } from 'react';
import { ChatHistoryItem } from 'core';

interface ScrollState {
  isAtBottom: boolean;
  isAtTop: boolean;
  showScrollButtons: boolean;
  isScrolling: boolean;
  userHasScrolledUp: boolean;
  lastScrollTop: number;
  autoScrollEnabled: boolean;
  hasScrollableContent: boolean;
  scrollProgress: number;
}

interface UseEnhancedScrollReturn {
  scrollState: ScrollState;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  newMessagesCount: number;
  scrollToBottom: (force?: boolean) => void;
  scrollToTop: () => void;
  enableAutoScroll: () => void;
  handleEscapeKey: () => boolean;
  forceCheckScrollState: () => void;
  isStreaming: boolean;
}

/**
 * Enhanced scroll hook with smart user-intent detection.
 *
 * Behaviour:
 *  - No manual intervention → auto-scroll keeps viewport at the bottom.
 *  - User scrolls up → auto-scroll disables, user has full control.
 *  - User scrolls back to the actual bottom (< 5 px) → auto-scroll re-enables.
 *  - Programmatic scrolls (from this hook) never count as user interaction.
 */
export const useEnhancedScroll = (
  history: ChatHistoryItem[],
  isStreamingProp: boolean
): UseEnhancedScrollReturn => {
  // --------------- React state (consumed by UI) ---------------
  const [scrollState, setScrollState] = useState<ScrollState>({
    isAtBottom: true,
    isAtTop: true,
    showScrollButtons: false,
    isScrolling: false,
    userHasScrolledUp: false,
    lastScrollTop: 0,
    autoScrollEnabled: true,
    hasScrollableContent: false,
    scrollProgress: 0
  });

  const [newMessagesCount, setNewMessagesCount] = useState(0);

  // --------------- Refs (always-current, no stale closures) ---------------
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ** Single source of truth for auto-scroll ** — never use scrollState for
  // deciding whether to scroll; always read this ref.
  const autoScrollEnabledRef = useRef(true);

  // Flag set *before* every programmatic scroll so the scroll-event handler
  // can ignore it instead of treating it as user interaction.
  const isProgrammaticScrollRef = useRef(false);

  const isStreamingRef = useRef(false);
  const lastMessageCountRef = useRef<number>(0);
  const lastViewedMessageCountRef = useRef<number>(0);
  const lastContentLengthRef = useRef(0);
  const lastContentHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);

  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const rafRef = useRef<number | null>(null);

  // --------------- Helpers ---------------

  /** Is the container scrolled to the actual bottom? */
  const isContainerAtBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 5;
  }, []);

  /** Update the UI-facing ScrollState from the DOM. */
  const checkScrollState = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const hasScrollableContent = scrollHeight > clientHeight + 5;
    const scrollProgress = hasScrollableContent
      ? scrollTop / Math.max(1, scrollHeight - clientHeight)
      : 1;
    const isAtTop = scrollTop < 5;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;
    const shouldShowButtons = hasScrollableContent && (!isAtTop || !isAtBottom);

    setScrollState(prev => {
      if (
        prev.isAtTop === isAtTop &&
        prev.isAtBottom === isAtBottom &&
        prev.showScrollButtons === shouldShowButtons &&
        prev.hasScrollableContent === hasScrollableContent &&
        Math.abs(prev.scrollProgress - scrollProgress) < 0.01
      ) {
        return prev;
      }
      return {
        ...prev,
        isAtTop,
        isAtBottom,
        showScrollButtons: shouldShowButtons,
        hasScrollableContent,
        scrollProgress
      };
    });
  }, []);

  // --------------- Programmatic scroll helpers ---------------

  /** Instant scroll to absolute bottom (programmatic — won't disrupt user). */
  const doImmediateScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight - el.clientHeight;
  }, []);

  /** Smooth scroll to bottom (programmatic). */
  const doSmoothScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  // --------------- Public scroll actions ---------------

  const scrollToBottom = useCallback((force = false) => {
    if (!force && !autoScrollEnabledRef.current) return;

    // Re-enable auto-scroll
    autoScrollEnabledRef.current = true;
    setScrollState(prev => ({
      ...prev,
      isAtBottom: true,
      userHasScrolledUp: false,
      autoScrollEnabled: true
    }));
    setNewMessagesCount(0);
    lastViewedMessageCountRef.current = history.length;

    if (force) {
      doImmediateScroll();
      requestAnimationFrame(() => {
        doImmediateScroll();
        requestAnimationFrame(() => doImmediateScroll());
      });
    } else {
      doSmoothScroll();
    }
  }, [history.length, doImmediateScroll, doSmoothScroll]);

  const scrollToTop = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTo({ top: 0, behavior: 'smooth' });

    autoScrollEnabledRef.current = false;
    setScrollState(prev => ({
      ...prev,
      isAtTop: true,
      userHasScrolledUp: true,
      autoScrollEnabled: false
    }));
  }, []);

  const enableAutoScroll = useCallback(() => {
    autoScrollEnabledRef.current = true;
    setScrollState(prev => ({
      ...prev,
      autoScrollEnabled: true,
      userHasScrolledUp: false
    }));
    setNewMessagesCount(0);
    lastViewedMessageCountRef.current = history.length;
  }, [history.length]);

  // --------------- Streaming scroll (called from interval / observers) ------

  /** Called at ~60 fps during streaming. Only scrolls if auto-scroll is on. */
  const immediateStreamingScroll = useCallback(() => {
    if (!autoScrollEnabledRef.current) return;
    doImmediateScroll();
  }, [doImmediateScroll]);

  // --------------- Content change detection ---------------

  const detectContentChanges = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      const h = el.scrollHeight;
      if (h !== lastContentHeightRef.current) {
        lastContentHeightRef.current = h;
        return true;
      }
    }

    const lastItem = history[history.length - 1];
    if (!lastItem) return false;
    const msg = lastItem.message;
    const content = typeof msg.content === 'string' ? msg.content : '';
    const reasoning = lastItem.reasoning?.text || '';
    const len = content.length + reasoning.length;
    if (len > lastContentLengthRef.current) {
      lastContentLengthRef.current = len;
      return true;
    }
    return false;
  }, [history]);

  // --------------- Streaming management effect ---------------

  useEffect(() => {
    const msgCount = history.length;
    const hasNew = msgCount > lastMessageCountRef.current;
    const streaming = isStreamingProp;
    const wasStreaming = isStreamingRef.current;
    const justFinished = wasStreaming && !streaming;

    lastMessageCountRef.current = msgCount;
    isStreamingRef.current = streaming;

    // Track unseen messages when user is scrolled up
    if (hasNew && !autoScrollEnabledRef.current) {
      setNewMessagesCount(Math.max(0, msgCount - lastViewedMessageCountRef.current));
    }

    if (autoScrollTimeoutRef.current) clearTimeout(autoScrollTimeoutRef.current);

    if (streaming) {
      // Start 60-fps interval
      if (streamingScrollIntervalRef.current) clearInterval(streamingScrollIntervalRef.current);
      streamingScrollIntervalRef.current = setInterval(() => {
        if (detectContentChanges()) immediateStreamingScroll();
      }, 16);

      autoScrollTimeoutRef.current = setTimeout(() => immediateStreamingScroll(), 10);
    } else if (justFinished) {
      // Streaming ended — clean up interval
      if (streamingScrollIntervalRef.current) {
        clearInterval(streamingScrollIntervalRef.current);
        streamingScrollIntervalRef.current = null;
      }
      lastContentLengthRef.current = 0;

      // Only scroll to bottom if auto-scroll is still enabled (user didn't opt out)
      if (autoScrollEnabledRef.current) {
        autoScrollTimeoutRef.current = setTimeout(() => {
          scrollToBottom(true);
        }, 50);
      }
    } else if (hasNew) {
      if (autoScrollEnabledRef.current) {
        autoScrollTimeoutRef.current = setTimeout(() => scrollToBottom(), 300);
      }
    }

    return () => {
      if (autoScrollTimeoutRef.current) clearTimeout(autoScrollTimeoutRef.current);
      if (streamingScrollIntervalRef.current) clearInterval(streamingScrollIntervalRef.current);
    };
  }, [history, isStreamingProp, scrollToBottom, immediateStreamingScroll, detectContentChanges]);

  // --------------- Scroll event handler ---------------

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      // ---- Ignore programmatic scrolls ----
      if (isProgrammaticScrollRef.current) {
        isProgrammaticScrollRef.current = false;
        // Still update UI state
        checkScrollState();
        lastScrollTopRef.current = el.scrollTop;
        return;
      }

      // ---- This is a real user scroll ----
      const { scrollTop, scrollHeight, clientHeight } = el;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;
      const isAtTop = scrollTop < 5;
      const scrolledUp = scrollTop < lastScrollTopRef.current && !isAtBottom;

      lastScrollTopRef.current = scrollTop;

      if (scrolledUp) {
        // User scrolled up → disable auto-scroll immediately
        autoScrollEnabledRef.current = false;
        setScrollState(prev => ({
          ...prev,
          isAtTop,
          isAtBottom,
          isScrolling: true,
          lastScrollTop: scrollTop,
          userHasScrolledUp: true,
          autoScrollEnabled: false,
          showScrollButtons: true,
          scrollProgress: scrollTop / Math.max(1, scrollHeight - clientHeight)
        }));
      } else if (isAtBottom) {
        // User scrolled back to the bottom → re-enable auto-scroll
        autoScrollEnabledRef.current = true;
        setScrollState(prev => ({
          ...prev,
          isAtTop,
          isAtBottom: true,
          isScrolling: true,
          lastScrollTop: scrollTop,
          userHasScrolledUp: false,
          autoScrollEnabled: true,
          scrollProgress: 1
        }));
        setNewMessagesCount(0);
        lastViewedMessageCountRef.current = history.length;
      } else {
        // Scrolling down but not yet at bottom — keep current auto-scroll state
        checkScrollState();
        setScrollState(prev => ({
          ...prev,
          isScrolling: true,
          lastScrollTop: scrollTop
        }));
      }

      // Mark scrolling as stopped after a pause
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        setScrollState(prev => ({ ...prev, isScrolling: false }));
      }, 300);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [history.length, checkScrollState]);

  // --------------- ResizeObserver + MutationObserver ---------------

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const initialCheck = setTimeout(() => checkScrollState(), 0);

    resizeObserverRef.current = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        checkScrollState();
        if (isStreamingRef.current) immediateStreamingScroll();
      });
    });
    resizeObserverRef.current.observe(el);
    const content = el.firstElementChild;
    if (content) resizeObserverRef.current.observe(content);

    mutationObserverRef.current = new MutationObserver((mutations) => {
      const relevant = mutations.some(m =>
        m.type === 'childList' ||
        m.type === 'characterData' ||
        (m.type === 'attributes' &&
          ['style', 'class', 'data-streaming', 'data-generating'].includes(m.attributeName || ''))
      );
      if (relevant) {
        requestAnimationFrame(() => {
          checkScrollState();
          if (isStreamingRef.current) immediateStreamingScroll();
        });
      }
    });
    mutationObserverRef.current.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-streaming', 'data-generating']
    });

    scrollCheckIntervalRef.current = setInterval(() => checkScrollState(), 500);

    return () => {
      clearTimeout(initialCheck);
      resizeObserverRef.current?.disconnect();
      mutationObserverRef.current?.disconnect();
      if (scrollCheckIntervalRef.current) clearInterval(scrollCheckIntervalRef.current);
    };
  }, [checkScrollState, immediateStreamingScroll]);

  // Re-check on message count changes
  useEffect(() => {
    const t1 = setTimeout(() => checkScrollState(), 0);
    const t2 = setTimeout(() => checkScrollState(), 50);
    const t3 = setTimeout(() => checkScrollState(), 200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [history.length, checkScrollState]);

  // Handle escape key
  const handleEscapeKey = useCallback(() => {
    if (!autoScrollEnabledRef.current) {
      scrollToBottom(true);
      return true;
    }
    return false;
  }, [scrollToBottom]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (streamingScrollIntervalRef.current) clearInterval(streamingScrollIntervalRef.current);
      resizeObserverRef.current?.disconnect();
      mutationObserverRef.current?.disconnect();
      if (scrollCheckIntervalRef.current) clearInterval(scrollCheckIntervalRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const forceCheckScrollState = useCallback(() => checkScrollState(), [checkScrollState]);

  return {
    scrollState,
    scrollContainerRef,
    newMessagesCount,
    scrollToBottom,
    scrollToTop,
    enableAutoScroll,
    handleEscapeKey,
    forceCheckScrollState,
    isStreaming: isStreamingProp
  };
};
