import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface ImageThumbnail {
  id: string;
  src: string;
  name?: string;
}

interface ImageThumbnailAreaProps {
  images: ImageThumbnail[];
  onRemoveImage: (id: string) => void;
  onImageClick?: (imageUrl: string) => void;
}

export function ImageThumbnailArea({ images, onRemoveImage, onImageClick }: ImageThumbnailAreaProps) {
  const { t } = useTranslation();
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });

  if (images.length === 0) {
    return null;
  }

  const handleImageHover = (event: React.MouseEvent, imageUrl: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    
    // Calculate optimal position to ensure preview stays within viewport
    let x = rect.left + rect.width / 2;
    let y = rect.top - 10;
    
    // Adjust horizontal position if too close to edges
    const previewWidth = 324; // 300px + padding
    if (x - previewWidth / 2 < 10) {
      x = previewWidth / 2 + 10;
    } else if (x + previewWidth / 2 > viewportWidth - 10) {
      x = viewportWidth - previewWidth / 2 - 10;
    }
    
    // Adjust vertical position if too close to top
    const previewHeight = 224; // 200px + padding
    if (y - previewHeight < 10) {
      y = rect.bottom + 10; // Show below instead of above
    }
    
    setPreviewPosition({ x, y });
    setPreviewImage(imageUrl);
  };

  const handleImageLeave = () => {
    setPreviewImage(null);
  };

  const handleRemoveClick = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    onRemoveImage(id);
  };

  return (
    <>
      <div className="image-thumbnail-area">
        {/* <div className="image-thumbnail-header">
          <span className="image-count-badge">{images.length} 张图片</span>
        </div> */}
        <div className="image-thumbnail-grid">
          {images.map((image) => (
            <div 
              key={image.id}
              className="image-thumbnail-item"
              onMouseEnter={(e) => handleImageHover(e, image.src)}
              onMouseLeave={handleImageLeave}
              onClick={() => onImageClick?.(image.src)}
            >
              <img 
                src={image.src} 
                alt={image.name || t('uploadedImageAlt', { index: '' })}
                className="thumbnail-image"
              />
              <button
                className="remove-image-btn"
                onClick={(e) => handleRemoveClick(e, image.id)}
                title={t('deleteImage')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
      
      {/* Preview overlay */}
      {previewImage && createPortal(
        <div 
          className="image-preview-overlay show"
          style={{
            left: previewPosition.x,
            top: previewPosition.y,
            transform: previewPosition.y < 224 ? 'translate(-50%, 10px)' : 'translate(-50%, -100%)',
            pointerEvents: 'none',
            zIndex: 2147483647,
            position: 'fixed'
          }}
        >
          <img src={previewImage} alt={t('preview')} />
        </div>,
        document.body
      )}
    </>
  );
}
