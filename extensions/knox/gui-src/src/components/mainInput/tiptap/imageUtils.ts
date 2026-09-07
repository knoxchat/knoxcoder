import { IIdeMessenger } from "../../../context/IdeMessenger";
import i18n from "../../../i18n";

const IMAGE_RESOLUTION = 1024;

export function getDataUrlForFile(
  file: File,
  img: HTMLImageElement,
): string | undefined {
  const targetWidth = IMAGE_RESOLUTION;
  const targetHeight = IMAGE_RESOLUTION;
  const scaleFactor = Math.min(
    targetWidth / img.width,
    targetHeight / img.height,
  );

  const canvas = document.createElement("canvas");
  canvas.width = img.width * scaleFactor;
  canvas.height = img.height * scaleFactor;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("Error getting image data URL: Failed to get the 2d context.");
    return;
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const downsizedDataUrl = canvas.toDataURL("image/jpeg", 0.7);
  return downsizedDataUrl;
}

export async function handleImageFile(
  ideMessenger: IIdeMessenger,
  file: File,
): Promise<[HTMLImageElement, string] | undefined> {
  let filesize = file.size / 1024 / 1024; // filesize in MB
  // check image type and size
  if (
    [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/svg",
      "image/webp",
    ].includes(file.type) &&
    filesize < 10
  ) {
    // check dimensions
    let _URL = window.URL || window.webkitURL;
    let img = new window.Image();
    img.src = _URL.createObjectURL(file);

    return await new Promise((resolve) => {
      img.onload = function () {
        const dataUrl = getDataUrlForFile(file, img);
        if (!dataUrl) {
          return;
        }

        let image = new window.Image();
        image.src = dataUrl;
        image.onload = function () {
          resolve([image, dataUrl]);
        };
      };
    });
  } else {
    ideMessenger.post("showToast", [
      "error",
      i18n.t('imageSizeFormatError'),
    ]);
  }
}

export async function handleMultipleImageFiles(
  ideMessenger: IIdeMessenger,
  files: FileList,
): Promise<Array<[HTMLImageElement, string]>> {
  const results: Array<[HTMLImageElement, string]> = [];
  const errors: string[] = [];
  
  // Process files in parallel for better performance
  const promises = Array.from(files).map(async (file) => {
    try {
      const result = await handleImageFile(ideMessenger, file);
      if (result) {
        return result;
      }
    } catch (error) {
      errors.push(i18n.t('imageProcessingError', { name: file.name }));
    }
    return null;
  });
  
  const processedResults = await Promise.all(promises);
  
  // Filter out null results and add valid ones
  for (const result of processedResults) {
    if (result) {
      results.push(result);
    }
  }
  
  // Show summary if there were any errors
  if (errors.length > 0) {
    const successCount = results.length;
    const totalCount = files.length;
    if (successCount > 0) {
      ideMessenger.post("showToast", [
        "warning",
        i18n.t('imageUploadPartialSuccess', { success: successCount, total: totalCount, failed: errors.length }),
      ]);
    }
  } else if (results.length > 1) {
    ideMessenger.post("showToast", [
      "info",
      i18n.t('imageUploadSuccess', { count: results.length }),
    ]);
  }
  
  return results;
}
