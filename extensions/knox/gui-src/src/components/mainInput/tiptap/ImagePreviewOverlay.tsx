import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';

interface ImagePreviewOverlayProps {
  imageUrl: string | null;
  cursorPosition: { x: number; y: number } | null;
  show: boolean;
}

export function ImagePreviewOverlay({ imageUrl, cursorPosition, show }: ImagePreviewOverlayProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isForceTop, setIsForceTop] = useState(false);

  useEffect(() => {
    if (cursorPosition && show) {
      // Smart positioning to avoid clipping
      const previewWidth = 300; // Max width of preview
      const previewHeight = 200; // Max height of preview
      const margin = 30; // Increased margin from edges
      const offsetY = 40; // Increased distance above cursor
      
      // Get viewport dimensions
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Calculate initial position (centered above cursor)
      let x = cursorPosition.x;
      let y = cursorPosition.y - offsetY;
      
      // Adjust horizontal position to prevent clipping
      const leftEdge = x - previewWidth / 2;
      const rightEdge = x + previewWidth / 2;
      
      if (leftEdge < margin) {
        // Too close to left edge, align to left with margin
        x = margin + previewWidth / 2;
      } else if (rightEdge > viewportWidth - margin) {
        // Too close to right edge, align to right with margin
        x = viewportWidth - margin - previewWidth / 2;
      }
      
      // Adjust vertical position to prevent clipping
      const topEdge = y - previewHeight;
      let forceTop = false;
      
      if (topEdge < margin) {
        // Not enough space above, try different strategies
        if (cursorPosition.y + previewHeight + 60 < viewportHeight - margin) {
          // Show below cursor if there's space
          y = cursorPosition.y + 60;
        } else {
          // Force show at top of screen when no other option works
          y = 10;
          forceTop = true;
        }
      }
      
      // Ensure preview never goes above viewport top
      if (y - previewHeight < 0) {
        y = 10;
        forceTop = true;
      }
      
      setIsForceTop(forceTop);
      setPosition({ x, y });
    }
  }, [cursorPosition, show]);

  if (!imageUrl || !show) {
    return null;
  }

  const overlay = (
    <div 
      className={`image-preview-overlay ${show ? 'show' : ''} ${isForceTop ? 'force-top' : ''}`}
      style={{
        left: position.x,
        top: isForceTop ? position.y : position.y,
        transform: isForceTop ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        willChange: 'transform, opacity' // Optimize for animations
      }}
    >
      <img 
        src={imageUrl} 
        alt={t('preview')}
        onLoad={(e) => {
          // Ensure the image maintains aspect ratio and doesn't exceed max dimensions
          const img = e.target as HTMLImageElement;
          const maxWidth = 300;
          const maxHeight = 200;
          
          if (img.naturalWidth > maxWidth || img.naturalHeight > maxHeight) {
            const aspectRatio = img.naturalWidth / img.naturalHeight;
            
            if (aspectRatio > maxWidth / maxHeight) {
              img.style.width = `${maxWidth}px`;
              img.style.height = `${maxWidth / aspectRatio}px`;
            } else {
              img.style.height = `${maxHeight}px`;
              img.style.width = `${maxHeight * aspectRatio}px`;
            }
          }
        }}
      />
    </div>
  );

  // Render to document body to avoid clipping by parent containers
  return createPortal(overlay, document.body);
}
