import React, { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { indexedDBManager } from '../../util/indexedDB';

// Hook to detect screen size
function useScreenSize() {
  const [isSmallScreen, setIsSmallScreen] = useState(false);

  useEffect(() => {
    const checkScreenSize = () => {
      setIsSmallScreen(window.innerWidth < 640);
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  return isSmallScreen;
}

interface ResizableSplitterProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  className?: string;
}

export function ResizableSplitter({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 320,
  minLeftWidth = 200,
  maxLeftWidth = 500,
  className
}: ResizableSplitterProps) {
  const storageKey = 'checkpoint-file-tree-width';
  
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const isSmallScreen = useScreenSize();

  // Load width from IndexedDB on mount
  useEffect(() => {
    let mounted = true;

    async function loadWidth() {
      try {
        // Try IndexedDB first
        const stored = await indexedDBManager.getItem(storageKey as any);
        
        if (mounted && stored) {
          const parsedWidth = typeof stored === 'string' ? parseInt(stored, 10) : (typeof stored === 'number' ? stored : defaultLeftWidth);
          // Ensure the stored width is within bounds
          if (typeof parsedWidth === 'number' && parsedWidth >= minLeftWidth && parsedWidth <= maxLeftWidth) {
            setLeftWidth(parsedWidth);
          }
        }
      } catch (error) {
        console.warn('Failed to read file tree width from IndexedDB:', error);
      }
    }

    loadWidth();

    return () => {
      mounted = false;
    };
  }, [storageKey, minLeftWidth, maxLeftWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const newLeftWidth = e.clientX - containerRect.left;
    
    // Dynamic constraints based on container width
    const containerWidth = containerRect.width;
    const dynamicMinWidth = Math.max(minLeftWidth, containerWidth * 0.15);
    const dynamicMaxWidth = Math.min(maxLeftWidth, containerWidth * 0.6);
    
    // Constrain within bounds
    const clampedWidth = Math.max(
      dynamicMinWidth,
      Math.min(dynamicMaxWidth, newLeftWidth)
    );
    
    setLeftWidth(clampedWidth);
    
    // Save to IndexedDB
    indexedDBManager.setItem(storageKey as any, clampedWidth as any).catch((error) => {
      console.warn('Failed to save file tree width to IndexedDB:', error);
    });
  }, [isDragging, minLeftWidth, maxLeftWidth, storageKey]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div 
      ref={containerRef}
      className={cn("h-full relative", "flex sm:flex-row flex-col", className)}
    >
      {/* Left Panel */}
      <div 
        className="overflow-hidden sm:flex-shrink-0 flex-1 sm:flex-initial"
        style={{ 
          width: isSmallScreen ? 'auto' : leftWidth, 
          height: isSmallScreen ? '40%' : 'auto' 
        }}
      >
        {leftPanel}
      </div>

      {/* Splitter - Desktop only */}
      <div
        ref={splitterRef}
        className={cn(
          "relative bg-border cursor-col-resize hover:bg-primary/50 transition-colors group hidden sm:block",
          "w-1 h-full",
          isDragging && "bg-primary"
        )}
        onMouseDown={handleMouseDown}
      >
        {/* Visual indicator */}
        <div className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-1 bg-transparent group-hover:bg-primary/30 transition-colors" />
        
        {/* Invisible wider hit area for easier grabbing */}
        <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
      </div>

      {/* Mobile Divider */}
      <div className="block sm:hidden h-1 bg-border" />

      {/* Right Panel */}
      <div className="min-w-0 overflow-hidden flex-1">
        {rightPanel}
      </div>
    </div>
  );
}
