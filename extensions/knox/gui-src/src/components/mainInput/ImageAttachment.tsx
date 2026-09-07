import React, { useCallback, useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ImageIcon, Paperclip } from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { handleMultipleImageFiles } from "./tiptap/imageUtils";
import { ImageThumbnailArea } from "./tiptap/ImageThumbnailArea";

export interface ImageAttachmentItem {
  id: string;
  src: string;
  name?: string;
}

interface ImageAttachmentProps {
  /** Current attached images */
  images: ImageAttachmentItem[];
  /** Called when images are added */
  onImagesAdded: (newImages: ImageAttachmentItem[]) => void;
  /** Called when an image is removed */
  onImageRemoved: (id: string) => void;
  /** Whether the current model supports image input */
  modelSupportsImages: boolean;
  /** Max number of images (default: 10) */
  maxImages?: number;
}

let imageIdCounter = 0;
function generateImageId(): string {
  return `img-${Date.now()}-${++imageIdCounter}`;
}

/**
 * ImageAttachment provides image paste/drag-drop support for the chat input.
 *
 * Features:
 * - Clipboard paste handling (Ctrl+V / Cmd+V)
 * - File drag-and-drop
 * - Click-to-browse upload button
 * - Thumbnail preview with remove buttons
 * - Image resize/compression before attaching (via imageUtils)
 * - Model capability detection (warns if model doesn't support vision)
 */
export function ImageAttachment({
  images,
  onImagesAdded,
  onImageRemoved,
  modelSupportsImages,
  maxImages = 10,
}: ImageAttachmentProps) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!modelSupportsImages) {
        ideMessenger.post("showToast", [
          "warning",
          t("modelDoesNotSupportImages"),
        ]);
        return;
      }

      const remaining = maxImages - images.length;
      if (remaining <= 0) {
        ideMessenger.post("showToast", [
          "warning",
          t("maxImagesReached"),
        ]);
        return;
      }

      const fileList =
        files instanceof FileList
          ? files
          : (() => {
              const dt = new DataTransfer();
              for (const f of files) dt.items.add(f);
              return dt.files;
            })();

      const results = await handleMultipleImageFiles(ideMessenger, fileList);
      const newImages: ImageAttachmentItem[] = results
        .slice(0, remaining)
        .map(([_img, dataUrl]: [HTMLImageElement, string]) => ({
          id: generateImageId(),
          src: dataUrl,
          name: undefined,
        }));

      if (newImages.length > 0) {
        onImagesAdded(newImages);
      }
    },
    [images.length, maxImages, modelSupportsImages, onImagesAdded, ideMessenger, t],
  );

  // Handle drag events
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (modelSupportsImages) {
        setIsDragOver(true);
      }
    },
    [modelSupportsImages],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        await processFiles(files);
      }
    },
    [processFiles],
  );

  // Handle paste
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        await processFiles(imageFiles);
      }
    },
    [processFiles],
  );

  // Handle file input change
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        await processFiles(e.target.files);
        // Reset input so the same file can be selected again
        e.target.value = "";
      }
    },
    [processFiles],
  );

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative"
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded border-2 border-dashed z-10"
          style={{
            backgroundColor: "var(--vscode-editor-background)",
            borderColor: "var(--vscode-focusBorder)",
            opacity: 0.9,
          }}
        >
          <span className="text-sm font-medium flex items-center gap-1.5">
            <Paperclip size={14} /> {t("dropImageHere")}
          </span>
        </div>
      )}

      {/* Image thumbnails */}
      <ImageThumbnailArea
        images={images}
        onRemoveImage={onImageRemoved}
      />

      {/* Upload button (only when model supports images and no images yet) */}
      {modelSupportsImages && images.length === 0 && (
        <button
          onClick={handleUploadClick}
          className="text-xs opacity-40 hover:opacity-70 px-1"
          title={t("attachImage")}
        >
          <ImageIcon size={12} />
        </button>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Model warning */}
      {!modelSupportsImages && images.length > 0 && (
        <div className="text-xs text-yellow-500 px-2 py-1 flex items-center gap-1">
          <AlertTriangle size={12} /> {t("currentModelNoVision")}
        </div>
      )}
    </div>
  );
}
