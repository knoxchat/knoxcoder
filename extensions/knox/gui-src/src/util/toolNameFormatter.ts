import { Tool } from "core";

/**
 * Format a tool function name into a more professional, enterprise-level display name
 * Transforms names like builtin_read_file to "Read File"
 * 
 * @param tool The tool object or function name to format
 * @returns A professionally formatted display name
 */
export function formatToolName(tool: Tool | string): string {
  const functionName = typeof tool === 'string' ? tool : tool.function.name;
  
  // If the tool already has a displayTitle, use it
  if (typeof tool !== 'string' && tool.displayTitle) {
    return tool.displayTitle;
  }

  // Remove common prefixes like builtin_ 
  let name = functionName.replace(/^builtin_/, '');
  
  // Split by underscores and convert to title case
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Returns a categorized version of the tool name
 * Adds a category prefix like [Files] Read File or [Search] Exact Search
 * 
 * @param tool The tool object or function name to categorize
 * @returns A categorized tool name
 */
export function getCategorizedToolName(tool: Tool | string): string {
  const functionName = typeof tool === 'string' ? tool : tool.function.name;
  const formattedName = formatToolName(tool);
  
  // Determine the category based on the function name
  let category = '';
  
  if (functionName.includes('memory')) {
    category = '[Memory]';
  } else if (functionName.includes('file') || functionName.includes('directory') || functionName.includes('map')) {
    category = '[Files]';
  } else if (functionName.includes('search')) {
    category = '[Search]';
  } else if (functionName.includes('terminal') || functionName.includes('command')) {
    category = '[Terminal]';
  } else if (functionName.includes('diff')) {
    category = '[Diff]';
  } else if (functionName.includes('web')) {
    category = '[Web]';
  } else {
    category = '[Tool]';
  }
  
  return `${category} ${formattedName}`;
}