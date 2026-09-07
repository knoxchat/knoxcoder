import React, { useEffect, useState } from "react";
import { indexedDBManager } from "../util/indexedDB";

interface SafeImg {
  src: string;
  height?: string;
  width?: string;
  className?: string;
  fallback: React.ReactNode;
}

const SafeImg: React.FC<SafeImg> = ({
  src,
  height,
  width,
  className,
  fallback,
}) => {
  const [hasError, setHasError] = useState(false);
  const [cachedSrc, setCachedSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadImage() {
      try {
        // Try to get from IndexedDB cache first
        const cachedImage = await indexedDBManager.getImage(src);
        if (mounted && cachedImage) {
          setCachedSrc(cachedImage);
          setIsLoading(false);
          return;
        }

        // If not cached, fetch and cache it
        const response = await fetch(src);
        const blob = await response.blob();
        
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = reader.result as string;
          if (mounted) {
            setCachedSrc(dataUrl);
            setIsLoading(false);
          }
          
          // Cache in IndexedDB for future use
          try {
            await indexedDBManager.setImage(src, dataUrl);
          } catch (error) {
            console.warn("Error caching image in IndexedDB:", error);
          }
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        // console.error("Error fetching image:", error);
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadImage();

    return () => {
      mounted = false;
    };
  }, [src]);

  const handleError = () => {
    setHasError(true);
    setCachedSrc(null);
  };

  return (
    <>
      {!hasError && !isLoading ? (
        <img
          src={cachedSrc || src}
          height={height}
          width={width}
          className={className}
          onError={handleError}
        />
      ) : !hasError && isLoading ? (
        <div 
          style={{ height, width }} 
          className={className}
        >
          {/* Optional: Add a loading spinner here */}
        </div>
      ) : (
        fallback
      )}
    </>
  );
};

export default SafeImg;
