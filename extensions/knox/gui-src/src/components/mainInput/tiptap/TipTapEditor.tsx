import { Editor, EditorContent, JSONContent } from "@tiptap/react";
import { ContextProviderDescription, InputModifiers } from "core";
import { modelSupportsImages } from "core/llm/autodetect";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../../context/IdeMessenger";
import useIsOSREnabled from "../../../hooks/useIsOSREnabled";
import useUpdatingRef from "../../../hooks/useUpdatingRef";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { selectDefaultModel } from "../../../redux/slices/configSlice";
import {
  selectIsInEditMode,
  setMainEditorContentTrigger,
} from "../../../redux/slices/sessionSlice";
import InputToolbar, { ToolbarOptions } from "../InputToolbar";
import { ComboBoxItem } from "../types";

import { DragOverlay } from "./DragOverlay";
import { createEditorConfig, getPlaceholderText } from "./editorConfig";
import { ImagePreviewOverlay } from "./ImagePreviewOverlay";
import { ImageThumbnailArea } from "./ImageThumbnailArea";
import { handleImageFile, handleMultipleImageFiles } from "./imageUtils";
import { useEditorEventHandlers } from "./keyHandlers";
import { InputBoxDiv } from "./StyledComponents";
import "./TipTapEditor.css";
import { useWebviewListeners } from "./useWebviewListeners";
import { t } from "i18next";

// Component to display historical images - matches ImageThumbnailArea styling and functionality
function HistoricalImageArea({ 
  images, 
  onRemoveImage 
}: { 
  images: string[];
  onRemoveImage?: (index: number) => void;
}) {
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

  const handleRemoveClick = (event: React.MouseEvent, index: number) => {
    event.stopPropagation();
    onRemoveImage?.(index);
  };

  return (
    <>
      <div className="image-thumbnail-area">
        <div className="image-thumbnail-grid">
          {images.map((imageUrl, index) => (
            <div 
              key={index}
              className="image-thumbnail-item"
              onMouseEnter={(e) => handleImageHover(e, imageUrl)}
              onMouseLeave={handleImageLeave}
              onClick={() => {
                // Open image in a new window/tab for full view
                window.open(imageUrl, '_blank');
              }}
            >
              <img 
                src={imageUrl} 
                alt={t('historicalImageAlt', { index: index + 1 })}
                className="thumbnail-image"
              />
              {onRemoveImage && (
                <button
                  className="remove-image-btn"
                  onClick={(e) => handleRemoveClick(e, index)}
                  title={t('deleteImage')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              )}
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

export interface TipTapEditorProps {
  availableContextProviders: ContextProviderDescription[];
  availableSlashCommands: ComboBoxItem[];
  isMainInput: boolean;
  onEnter: (
    editorState: JSONContent,
    modifiers: InputModifiers,
    editor: Editor,
  ) => void;
  editorState?: JSONContent;
  toolbarOptions?: ToolbarOptions;
  lumpOpen: boolean;
  setLumpOpen: (open: boolean) => void;
  placeholder?: string;
  historyKey: string;
  inputId: string;
  historicalImages?: string[];
  onRemoveHistoricalImage?: (index: number) => void;
  // Scroll navigation props
  showScrollButtons?: boolean;
  isAtTop?: boolean;
  isAtBottom?: boolean;
  onScrollToTop?: () => void;
  onScrollToBottom?: () => void;
}

export const FLOATING_UI_DIV_ID = "floating-ui-div";

function TipTapEditor(props: TipTapEditorProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const ideMessenger = useContext(IdeMessengerContext);

  const isOSREnabled = useIsOSREnabled();

  const defaultModel = useAppSelector(selectDefaultModel);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const isInEditMode = useAppSelector(selectIsInEditMode);
  const historyLength = useAppSelector((store) => store.session.history.length);

  // Uploaded images state for thumbnail area
  const [uploadedImages, setUploadedImages] = useState<{
    id: string;
    src: string;
    name?: string;
  }[]>([]);

  // Handle adding images to thumbnail area instead of editor
  const addImageToThumbnails = useCallback((imageUrl: string, name?: string) => {
    const newImage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      src: imageUrl,
      name
    };
    setUploadedImages(prev => [...prev, newImage]);
  }, []);

  // Handle removing images from thumbnail area
  const removeImageFromThumbnails = useCallback((id: string) => {
    setUploadedImages(prev => prev.filter(img => img.id !== id));
  }, []);

  // Handle image click for preview
  const handleImageClick = useCallback((imageUrl: string) => {
    // You can implement a full-screen preview or other functionality here
    console.log('Image clicked:', imageUrl);
  }, []);

  const { editor, onEnterRef } = createEditorConfig({
    props,
    ideMessenger,
    dispatch,
    addImageToThumbnails,
    uploadedImages,
    clearUploadedImages: () => setUploadedImages([]),
  });

  const [shouldHideToolbar, setShouldHideToolbar] = useState(true);

  // This allows anywhere in the app to set the content of the main input
  const mainInputContentTrigger = useAppSelector(
    (store) => store.session.mainEditorContentTrigger,
  );

  // Editor effects - moved after editor is defined
  useEffect(() => {
    if (!editor) {
      return;
    }
    const placeholder = getPlaceholderText(props.placeholder, historyLength, t);

    editor.extensionManager.extensions.filter(
      (extension) => extension.name === "placeholder",
    )[0].options["placeholder"] = placeholder;

    editor.view.dispatch(editor.state.tr);
  }, [editor, props.placeholder, historyLength, t]);

  useEffect(() => {
    if (isInEditMode) {
      setShouldHideToolbar(false);
    }
    if (props.isMainInput) {
      editor?.commands.clearContent(true);
    }
  }, [editor, isInEditMode, props.isMainInput]);

  const editorFocusedRef = useUpdatingRef(editor?.isFocused, [editor]);

  useEffect(() => {
    if (props.isMainInput) {
      /**
       * I have a strong suspicion that many of the other focus
       * commands are redundant, especially the ones inside
       * useTimeout.
       */
      editor?.commands.focus();
    }
  }, [props.isMainInput, editor]);

  // Re-focus main input after done generating
  useEffect(() => {
    if (editor && !isStreaming && props.isMainInput && document.hasFocus()) {
      editor.commands.focus(undefined, { scrollIntoView: false });
    }
  }, [props.isMainInput, isStreaming, editor]);

  useEffect(() => {
    if (!props.isMainInput || !mainInputContentTrigger) {
      return;
    }
    queueMicrotask(() => {
      editor?.commands.setContent(mainInputContentTrigger);
    });
    dispatch(setMainEditorContentTrigger(undefined));
  }, [editor, props.isMainInput, mainInputContentTrigger]);

  // Image preview event handlers
  useEffect(() => {
    if (!editor) {return;}

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'IMG' && target.closest('.ProseMirror')) {
        const img = target as HTMLImageElement;
        const rect = img.getBoundingClientRect();
        
        setImagePreview({
          imageUrl: img.src,
          position: {
            x: rect.left + rect.width / 2,
            y: rect.top
          }
        });
      }
    };

    const handleMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'IMG' && target.closest('.ProseMirror')) {
        setImagePreview(null);
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener('mouseover', handleMouseOver);
    editorElement.addEventListener('mouseout', handleMouseOut);

    return () => {
      editorElement.removeEventListener('mouseover', handleMouseOver);
      editorElement.removeEventListener('mouseout', handleMouseOut);
    };
  }, [editor]);

  // IDE event listeners
  useWebviewListeners({
    editor,
    onEnterRef,
    dispatch,
    historyLength,
    props,
    editorFocusedRef,
    addImageToThumbnails,
  });

  const [showDragOverMsg, setShowDragOverMsg] = useState(false);

  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Image preview state
  const [imagePreview, setImagePreview] = useState<{
    imageUrl: string;
    position: { x: number; y: number };
  } | null>(null);



  const insertCharacterWithWhitespace = useCallback(
    (char: string) => {
      if (!editor) {
        return;
      }
      
      // Ensure focus first to properly position the dropdown
      editor.commands.focus('end');
      
      const text = editor.getText();
      if (!text.endsWith(char)) {
        if (text.length > 0 && !text.endsWith(" ")) {
          editor.commands.insertContent(` ${char}`);
        } else {
          editor.commands.insertContent(char);
        }
      }
    },
    [editor],
  );

  const { handleKeyUp, handleKeyDown } = useEditorEventHandlers({
    editor,
    isOSREnabled: isOSREnabled,
    editorFocusedRef,
    isInEditMode,
    setActiveKey,
  });

  const blurTimeout = useRef<NodeJS.Timeout | null>(null);
  const cancelBlurTimeout = useCallback(() => {
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }
  }, [blurTimeout]);

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (isInEditMode) {
        return;
      }
      // Check if the new focus target is within our InputBoxDiv
      const currentTarget = e.currentTarget;
      const relatedTarget = e.relatedTarget as Node | null;

      if (relatedTarget && currentTarget?.contains(relatedTarget)) {
        return;
      }
      // Otherwise give e.g. listboxes a chance to cancel the hiding
      blurTimeout.current = setTimeout(() => {
        setShouldHideToolbar(true);
      }, 100);
    },
    [isInEditMode, blurTimeout],
  );

  const handleFocus = useCallback(() => {
    cancelBlurTimeout();
    setShouldHideToolbar(false);
  }, [cancelBlurTimeout]);

  // TODO pass clear blur timeout to model and mode selectors
  // Seems like unnecessary for now?

  return (
    <InputBoxDiv
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className={shouldHideToolbar ? "cursor-default" : "cursor-text"}
      onClick={() => {
        editor?.commands.focus();
      }}
      onDragOver={(event) => {
        // Prevent default to allow drop and override VSCode behavior
        event.preventDefault();
        event.stopPropagation();
        
        // Check if we have image files being dragged
        const hasImages = Array.from(event.dataTransfer.items).some(
          item => item.type.startsWith('image/')
        );
        
        if (hasImages) {
          setShowDragOverMsg(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) {
          setTimeout(() => setShowDragOverMsg(false), 1000);
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        
        // Check if we have image files being dragged
        const hasImages = Array.from(event.dataTransfer.items).some(
          item => item.type.startsWith('image/')
        );
        
        if (hasImages) {
          setShowDragOverMsg(true);
        }
      }}
      onDrop={(event) => {
        // Always prevent default and stop propagation to override VSCode behavior
        event.preventDefault();
        event.stopPropagation();
        
        setShowDragOverMsg(false);
        
        if (
          !defaultModel ||
          !modelSupportsImages(
            defaultModel.provider,
            defaultModel.model,
            defaultModel.title,
            defaultModel.capabilities,
          )
        ) {
          ideMessenger.post("showToast", [
            "warning", 
            t('modelNoImageSupport')
          ]);
          return;
        }
        
        const files = event.dataTransfer.files;
        if (files.length === 0) {
          return;
        }

        // Filter only image files
        const imageFiles = Array.from(files).filter(file => 
          file.type.startsWith('image/')
        );
        
        if (imageFiles.length === 0) {
          ideMessenger.post("showToast", [
            "warning", 
            t('pleaseDropImageFiles')
          ]);
          return;
        }

        // Handle multiple images
        const fileList = new DataTransfer();
        imageFiles.forEach(file => fileList.items.add(file));
        
        handleMultipleImageFiles(ideMessenger, fileList.files).then((results: Array<[HTMLImageElement, string]>) => {
          if (results.length === 0) {
            return;
          }
          
          // Add images to thumbnail area instead of editor
          results.forEach(([, dataUrl]: [HTMLImageElement, string]) => {
            addImageToThumbnails(dataUrl);
          });
        });
      }}
    >
      <div className="px-2 pb-0.5 pt-0.5">
        <ImageThumbnailArea
          images={uploadedImages}
          onRemoveImage={removeImageFromThumbnails}
          onImageClick={handleImageClick}
        />
        <HistoricalImageArea 
          images={props.historicalImages || []} 
          onRemoveImage={props.onRemoveHistoricalImage}
        />
        <EditorContent
          className={`scroll-container overflow-y-scroll ${props.isMainInput ? "max-h-[70vh]" : ""}`}
          spellCheck={false}
          editor={editor}
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
        <InputToolbar
          isMainInput={props.isMainInput}
          toolbarOptions={props.toolbarOptions}
          activeKey={activeKey}
          hidden={shouldHideToolbar && !props.isMainInput}
          onAddContextItem={() => insertCharacterWithWhitespace("@")}
          lumpOpen={props.lumpOpen}
          setLumpOpen={props.setLumpOpen}
          onEnter={onEnterRef.current}
          onImageFileSelected={(file) => {
            handleImageFile(ideMessenger, file).then((result) => {
              if (result) {
                const [, dataUrl] = result;
                addImageToThumbnails(dataUrl, file.name);
              }
            });
          }}
          disabled={isStreaming}
          showScrollButtons={props.showScrollButtons}
          isAtTop={props.isAtTop}
          isAtBottom={props.isAtBottom}
          onScrollToTop={props.onScrollToTop}
          onScrollToBottom={props.onScrollToBottom}
        />
      </div>

      {showDragOverMsg &&
        modelSupportsImages(
          defaultModel?.provider || "",
          defaultModel?.model || "",
          defaultModel?.title,
          defaultModel?.capabilities,
        ) && (
          <DragOverlay show={showDragOverMsg} setShow={setShowDragOverMsg} />
        )}
      
      <ImagePreviewOverlay 
        imageUrl={imagePreview?.imageUrl || null}
        cursorPosition={imagePreview?.position || null}
        show={!!imagePreview}
      />
      
      <div id={FLOATING_UI_DIV_ID} className="fixed z-50 top-0 left-0 w-screen h-screen pointer-events-none" />
    </InputBoxDiv>
  );
}

export default TipTapEditor;
