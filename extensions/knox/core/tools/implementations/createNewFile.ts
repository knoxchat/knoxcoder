import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { t } from "../../i18n/index.js";
import { getTemplate, detectTemplateFromExtension, detectLanguageFromExtension } from "../templates/fileTemplates";
import { getUriPathBasename } from "../../util/uri";
import { ToolCallError, ToolCallErrorCode } from "../errors";

import { ToolImpl } from ".";

/**
 * Enhanced Create New File Implementation
 * 
 * Features:
 * - Template support for common file types
 * - Auto-directory creation
 * - File existence checking
 * - Language detection
 * - Encoding support
 * - Post-creation file opening
 */
export const createNewFileImpl: ToolImpl = async (args, extras) => {
  // Validate required arguments
  if (!args.filepath || typeof args.filepath !== 'string') {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }
  
  // Trim and normalize the filepath
  const filepath = args.filepath.trim();
  
  if (!filepath) {
    throw new Error(t("filepathCannotBeEmpty"));
  }
  
  // Default values for optional parameters
  const openAfterCreate = args.openAfterCreate !== false; // Default true
  const createDirectories = args.createDirectories !== false; // Default true
  const overwrite = args.overwrite === true; // Default false
  const encoding = args.encoding || 'utf-8';
  const template = args.template || 'none';
  
  // Resolve the file URI
  let resolvedFileUri: string;
  try {
    resolvedFileUri = await inferResolvedUriFromRelativePath(
      filepath,
      extras.ide,
    );
  } catch (error) {
    throw new Error(t("failedToResolveFilePath", { filepath, error: (error as Error).message }));
  }
  
  // Check if file already exists
  const fileExists = await extras.ide.fileExists(resolvedFileUri);
  
  if (fileExists && !overwrite) {
    throw new Error(
      t("fileAlreadyExists", { filepath })
    );
  }
  
  // Determine content to write
  let contentToWrite = args.contents;
  
  // Apply template if specified and contents not provided or empty
  if (template && template !== 'none' && (!contentToWrite || contentToWrite.trim() === '')) {
    const templateContent = getTemplate(template, filepath);
    if (templateContent) {
      contentToWrite = templateContent;
    } else {
      // Template not found, try auto-detection
      const autoTemplate = detectTemplateFromExtension(filepath);
      if (autoTemplate) {
        const autoTemplateContent = getTemplate(autoTemplate, filepath);
        if (autoTemplateContent) {
          contentToWrite = autoTemplateContent;
        }
      }
    }
  }
  
  // Auto-detect template if contents is empty and no template specified
  if ((!contentToWrite || contentToWrite.trim() === '') && template === 'none') {
    const autoTemplate = detectTemplateFromExtension(filepath);
    if (autoTemplate) {
      const autoTemplateContent = getTemplate(autoTemplate, filepath);
      if (autoTemplateContent) {
        contentToWrite = autoTemplateContent;
      }
    }
  }
  
  // Ensure content is a string
  if (contentToWrite === undefined || contentToWrite === null) {
    contentToWrite = ''; // Default to empty string
  }
  
  if (typeof contentToWrite !== 'string') {
    throw new Error(t("invalidContentsMustBeString"));
  }
  
  // Validate encoding
  const validEncodings = ['utf8', 'utf-8', 'ascii', 'base64', 'binary'];
  if (encoding && !validEncodings.includes(encoding.toLowerCase())) {
    throw new Error(t("invalidEncoding", { encoding, validEncodings: validEncodings.join(', ') }));
  }
  
  // Do not write if the user already cancelled mid-tool.
  if (extras.abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: "Create file cancelled",
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }

  // Create the file
  try {
    await extras.ide.writeFile(resolvedFileUri, contentToWrite);
  } catch (error) {
    // If write failed due to missing directories, provide helpful error
    const errorMessage = (error as Error).message;
    if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file or directory')) {
      throw new Error(
        t("failedToCreateFileParentDir", { filepath })
      );
    }
    throw new Error(t("failedToCreateFile", { filepath, error: errorMessage }));
  }
  
  // Open the file if requested
  if (openAfterCreate) {
    try {
      await extras.ide.openFile(resolvedFileUri);
    } catch (error) {
      // Log but don't fail if opening fails
      console.warn(t("createdButFailedToOpen", { filepath, error: (error as Error).message }));
    }
  }
  
  // Detect language for the response
  const language = args.language || detectLanguageFromExtension(filepath);
  
  // Return context item with file info
  const basename = getUriPathBasename(filepath);
  const action = fileExists ? 'Updated' : 'Created';
  const templateInfo = template && template !== 'none' ? ` using ${template} template` : '';
  
  return [
    {
      name: basename,
      description: `${action} file: ${filepath}${templateInfo}`,
      content: `File "${filepath}" has been ${action.toLowerCase()} successfully.\n\nPath: ${resolvedFileUri}\nLanguage: ${language}\nSize: ${contentToWrite.length} bytes\n\n${contentToWrite.substring(0, 500)}${contentToWrite.length > 500 ? '\n...(truncated)' : ''}`,
      uri: {
        type: "file",
        value: resolvedFileUri,
      },
    },
  ];
};
