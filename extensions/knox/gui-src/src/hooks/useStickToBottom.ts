import { useCallback, useEffect, useRef, useState } from "react";

/** Near-bottom slack, matching chat streaming / Streamdown follow. */
const BOTTOM_THRESHOLD_PX = 8;

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function isAtBottom(el: HTMLElement, threshold = BOTTOM_THRESHOLD_PX): boolean {
  return distanceFromBottom(el) <= threshold;
}

export interface UseStickToBottomOptions {
  /**
   * When true, new content keeps the viewport pinned to the bottom
   * unless the user has scrolled up to browse.
   */
  follow: boolean;
  /** Changes whenever the list grows or the latest row updates. */
  contentKey: unknown;
  /**
   * When this becomes truthy (e.g. the panel expands), re-enable
   * following and jump to the latest row.
   */
  resetKey?: unknown;
}

/**
 * Stick-to-bottom scrolling with the same intent as chat streaming:
 * follow new rows while at the bottom, pause when the user scrolls up,
 * resume when they scroll back to the bottom.
 */
export function useStickToBottom({
  follow,
  contentKey,
  resetKey,
}: UseStickToBottomOptions) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const followEnabledRef = useRef(true);
  const programmaticRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const followRef = useRef(follow);
  followRef.current = follow;

  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScroller(node);
  }, []);

  const stick = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    programmaticRef.current = true;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  }, []);

  const maybeStick = useCallback(() => {
    if (followRef.current && followEnabledRef.current) {
      stick();
    }
  }, [stick]);

  useEffect(() => {
    const el = scroller;
    if (!el) {
      return;
    }

    const onScroll = () => {
      if (programmaticRef.current) {
        lastScrollTopRef.current = el.scrollTop;
        return;
      }

      const atBottom = isAtBottom(el);
      const scrolledUp = el.scrollTop < lastScrollTopRef.current - 0.5;

      lastScrollTopRef.current = el.scrollTop;

      if (scrolledUp) {
        followEnabledRef.current = false;
      } else if (atBottom) {
        followEnabledRef.current = true;
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        followEnabledRef.current = false;
      } else if (isAtBottom(el)) {
        followEnabledRef.current = true;
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    lastScrollTopRef.current = el.scrollTop;

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
    };
  }, [scroller]);

  useEffect(() => {
    if (!resetKey || !scroller) {
      return;
    }
    followEnabledRef.current = true;
    requestAnimationFrame(stick);
  }, [resetKey, scroller, stick]);

  useEffect(() => {
    if (!follow) {
      return;
    }
    requestAnimationFrame(maybeStick);
  }, [follow, contentKey, maybeStick]);

  useEffect(() => {
    const el = scroller;
    if (!el) {
      return;
    }

    const onGrow = () => maybeStick();

    const mutationObserver = new MutationObserver(onGrow);
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(onGrow);
      resizeObserver.observe(el);
      const content = el.firstElementChild;
      if (content) {
        resizeObserver.observe(content);
      }
    }

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [scroller, contentKey, maybeStick]);

  return { scrollRef: setScrollRef, isFollowingRef: followEnabledRef };
}
