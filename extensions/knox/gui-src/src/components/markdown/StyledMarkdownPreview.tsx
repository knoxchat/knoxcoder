import { ctxItemToRifWithContents } from "core/commands/util";
import React, { memo, useMemo, ReactNode } from "react";
import { Marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { v4 as uuidv4 } from "uuid";
import { parseMarkdownIntoBlocks } from "streamdown";

import {
  vscBackground,
  vscEditorBackground,
  vscForeground,
} from "..";
import useUpdatingRef from "../../hooks/useUpdatingRef";
import { useAppSelector } from "../../redux/hooks";
import { selectUIConfig } from "../../redux/slices/configSlice";
import { getContextItemsFromHistory } from "../../redux/thunks/updateFileSymbols";
import { getFontSize } from "../../util";
import { ToolTip } from "../gui/Tooltip";

import FilenameLink from "./FilenameLink";
import "./markdown.css";
import StepContainerPreActionButtons from "./StepContainerPreActionButtons";
import StepContainerPreToolbar from "./StepContainerPreToolbar/StepContainerPreToolbar";
import SymbolLink from "./SymbolLink";
import { SyntaxHighlightedPre } from "./SyntaxHighlightedPre";
import { isSymbolNotRif, matchCodeToSymbolOrFile } from "./utils";
import { patchNestedMarkdown } from "./utils/patchNestedMarkdown";

interface StyledMarkdownPreviewProps {
  source?: string;
  className?: string;
  isRenderingInStepContainer?: boolean;
  scrollLocked?: boolean;
  itemIndex?: number;
  useParentBackgroundColor?: boolean;
  isStreaming?: boolean;
  fontSize?: number;
  expanded?: boolean;
}

interface CodeBlockData {
  index: number;
  code: string;
  language: string;
  relativeFilePath: string;
  range: string;
  isLast: boolean;
}

const StyledMarkdownPreview = memo(function StyledMarkdownPreview(
  props: StyledMarkdownPreviewProps,
) {
  const history = useAppSelector((state) => state.session.history);
  const allSymbols = useAppSelector((state) => state.session.symbols);

  const pastFileInfo = useMemo(() => {
    const index = props.itemIndex;
    if (index === undefined) {
      return {
        symbols: [],
        rifs: [],
      };
    }
    const pastContextItems = getContextItemsFromHistory(history, index);
    const rifs = pastContextItems.map((item) =>
      ctxItemToRifWithContents(item, true),
    );
    const symbols = Object.entries(allSymbols)
      .filter((e) => pastContextItems.find((item) => item.uri!.value === e[0]))
      .map((f) => f[1])
      .flat();

    return {
      symbols,
      rifs,
    };
  }, [props.itemIndex, history, allSymbols]);

  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const uiConfig = useAppSelector(selectUIConfig);
  const codeWrapState = uiConfig?.codeWrap ? "pre-wrap" : "pre";

  // Use refs to avoid recreating on every render
  const pastFileInfoRef = useUpdatingRef(pastFileInfo);

  // Use useMemo instead of useEffect + useState for synchronous rendering
  // This ensures streaming content appears in real-time without batching delays
  const renderedContent = useMemo(() => {
    let sourceToRender = props.source ?? "";
    
    // When streaming, use streamdown's parseMarkdownIntoBlocks to handle incomplete markdown
    // This properly handles incomplete code blocks, lists, etc. during streaming
    if (props.isStreaming && sourceToRender) {
      const blocks = parseMarkdownIntoBlocks(sourceToRender);
      // Rejoin blocks - streamdown already handles incomplete blocks properly
      sourceToRender = blocks.join('\n\n');
      
      // Ensure incomplete code fences are properly closed for marked parsing
      // This prevents code block content from being rendered as plain text
      // until the closing fence arrives from the stream
      const fenceRegex = /^(`{3,})/gm;
      let fenceCount = 0;
      let lastFenceMatch: RegExpExecArray | null = null;
      let match: RegExpExecArray | null;
      while ((match = fenceRegex.exec(sourceToRender)) !== null) {
        fenceCount++;
        lastFenceMatch = match;
      }
      // Odd number of fences means the last code block is unclosed
      if (fenceCount > 0 && fenceCount % 2 === 1 && lastFenceMatch) {
        const closingFence = lastFenceMatch[1]; // Match the backtick length
        sourceToRender = sourceToRender + '\n' + closingFence;
      }
    }
    
    const patchedSource = patchNestedMarkdown(sourceToRender);
    
    // Store code blocks data for later processing
    const codeBlocks: CodeBlockData[] = [];
    let codeBlockIndex = 0;

    // Create a new Marked instance WITHOUT markedHighlight
    // We'll apply highlighting manually to preserve the HTML structure
    const marked = new Marked();

    // Configure marked options
    marked.setOptions({
      gfm: true,
      breaks: true,
    });

    // Custom renderer
    const renderer: any = {
      code(token: any) {
        const code = token.text;
        const infostring = token.lang;
        const lang = (infostring || '').match(/^\S*/)?.[0] || '';
        const meta = (infostring || '').substring(lang.length).trim();
        const language = lang || 'javascript';
        
        // Parse metadata
        let relativeFilePath = '';
        let range = '';
        if (meta) {
          const metaParts = meta.split(' ');
          relativeFilePath = metaParts[0] || '';
          range = metaParts[1] || '';
        }

        const blockData: CodeBlockData = {
          index: codeBlockIndex,
          code,
          language,
          relativeFilePath,
          range,
          isLast: false,
        };
        codeBlocks.push(blockData);

        // Return a placeholder div that we'll replace with React component
        const placeholder = `<div class="code-block-placeholder" data-block-index="${codeBlockIndex}"></div>`;
        codeBlockIndex++;

        return placeholder;
      },

      // Handle inline code to support symbol/file links
      codespan(token: any) {
        const text = token.text;
        return `<code class="inline-code" data-content="${encodeURIComponent(text)}">${text}</code>`;
      },

      // Handle links with tooltips
      link(token: any) {
        const href = token.href;
        const title = token.title;
        const text = token.text;
        const tooltipId = uuidv4();
        return `<a href="${href || ''}" target="_blank" class="hover:underline markdown-link" data-tooltip-id="${tooltipId}" data-tooltip-href="${href || ''}">${text}</a>`;
      },
    };

    marked.use({ renderer });

    // Parse markdown to HTML
    let rawHtml = marked.parse(patchedSource) as string;

    // Mark last code block - during streaming, the last block is being generated
    if (codeBlocks.length > 0) {
      codeBlocks[codeBlocks.length - 1].isLast = true;
    }

    // Sanitize HTML
    const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['data-block-index', 'data-content', 'data-tooltip-id', 'data-tooltip-href', 'target'],
      ADD_TAGS: ['div'],
    });

    // Parse the HTML and replace placeholders with React components
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sanitizedHtml;

    // Collect all replacements to be made
    const replacements: Array<{ element: Element; component: ReactNode }> = [];

    // Process code block placeholders
    const placeholders = tempDiv.querySelectorAll('.code-block-placeholder');
    placeholders.forEach((placeholder) => {
      const blockIndexStr = placeholder.getAttribute('data-block-index');
      if (blockIndexStr === null) return;
      
      const blockIndex = parseInt(blockIndexStr, 10);
      const blockData = codeBlocks[blockIndex];
      if (!blockData) return;

      // Apply syntax highlighting
      let highlightedCode: string;
      try {
        if (hljs.getLanguage(blockData.language)) {
          highlightedCode = hljs.highlight(blockData.code, { language: blockData.language }).value;
        } else {
          highlightedCode = hljs.highlightAuto(blockData.code).value;
        }
      } catch (err) {
        console.error('Highlight error:', err);
        highlightedCode = blockData.code;
      }

      // Determine if this code block is currently being generated
      // It's generating if: streaming is active AND this is the last code block
      const isGenerating = !!(props.isStreaming && blockData.isLast);

      // Create a code element with syntax-highlighted HTML
      // Structure it to match what react-remark + rehype-highlight produced
      const codeElement = (
        <code
          key={`code-content-${blockData.index}`}
          className={`hljs language-${blockData.language}${isGenerating ? ' generating' : ''}`}
          data-relativefilepath={blockData.relativeFilePath}
          data-codeblockcontent={blockData.code}
          data-isgeneratingcodeblock={isGenerating}
          data-range={blockData.range}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      );

      const preProps = {
        'data-codeblockindex': blockData.index,
        'data-generating': isGenerating,
        children: [codeElement], // Array with code element as first item
      };

      let component: ReactNode;

      if (!props.isRenderingInStepContainer) {
        component = <SyntaxHighlightedPre key={`code-${blockData.index}`} {...preProps} />;
      } else if (!blockData.relativeFilePath) {
        component = (
          <StepContainerPreActionButtons
            key={`code-${blockData.index}`}
            language={blockData.language}
            codeBlockContent={blockData.code}
            codeBlockIndex={blockData.index}
            isGenerating={isGenerating}
          >
            <SyntaxHighlightedPre {...preProps} />
          </StepContainerPreActionButtons>
        );
      } else {
        component = (
          <StepContainerPreToolbar
            key={`code-${blockData.index}`}
            codeBlockContent={blockData.code}
            codeBlockIndex={blockData.index}
            language={blockData.language}
            relativeFilepath={blockData.relativeFilePath}
            isGeneratingCodeBlock={isGenerating}
            range={blockData.range}
            expanded={props.expanded}
          >
            <SyntaxHighlightedPre {...preProps} />
          </StepContainerPreToolbar>
        );
      }

      replacements.push({ element: placeholder, component });
    });

    // Process inline code for symbol/file links
    const inlineCodes = tempDiv.querySelectorAll('code.inline-code');
    inlineCodes.forEach((codeEl) => {
      const encodedContent = codeEl.getAttribute('data-content');
      if (!encodedContent) return;
      
      const content = decodeURIComponent(encodedContent);
      const { symbols, rifs } = pastFileInfoRef.current;
      const matchedSymbolOrFile = matchCodeToSymbolOrFile(content, symbols, rifs);
      
      if (matchedSymbolOrFile) {
        let component: ReactNode;
        if (isSymbolNotRif(matchedSymbolOrFile)) {
          component = <SymbolLink key={`symbol-${content}`} content={content} symbol={matchedSymbolOrFile} />;
        } else {
          component = <FilenameLink key={`file-${content}`} rif={matchedSymbolOrFile} />;
        }
        replacements.push({ element: codeEl, component });
      }
    });

    // Convert HTML to React elements and apply replacements
    const convertHtmlToReact = (node: ChildNode, index: number = 0, parentTagName: string = ''): ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        
        // Skip whitespace-only text nodes in table elements where they're not allowed
        const invalidParents = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'];
        if (invalidParents.includes(parentTagName) && text.trim() === '') {
          return null;
        }
        
        return text;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();
        
        // Check if this element should be replaced with a React component
        const replacement = replacements.find(r => r.element === element);
        if (replacement) {
          return replacement.component;
        }

        // Handle links with tooltips
        if (tagName === 'a' && element.classList.contains('markdown-link')) {
          const tooltipId = element.getAttribute('data-tooltip-id');
          const href = element.getAttribute('data-tooltip-href') || element.getAttribute('href');
          const text = element.textContent;
          
          return (
            <span key={`link-wrapper-${index}`}>
              <a 
                href={href || ''} 
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline markdown-link"
              >
                {text}
              </a>
              {tooltipId && href && (
                <ToolTip id={tooltipId} place="top" className="m-0 p-0">
                  {href}
                </ToolTip>
              )}
            </span>
          );
        }

        // Convert regular HTML elements to React elements
        const props: any = { key: `${tagName}-${index}` };
        
        // Copy attributes with proper React conversions
        Array.from(element.attributes).forEach(attr => {
          let attrName = attr.name;
          let attrValue: any = attr.value;
          
          // Convert class to className
          if (attrName === 'class') {
            attrName = 'className';
          }
          // Convert style string to object
          else if (attrName === 'style' && typeof attrValue === 'string') {
            const styleObject: any = {};
            attrValue.split(';').forEach((style: string) => {
              const [key, value] = style.split(':').map(s => s.trim());
              if (key && value) {
                // Convert kebab-case to camelCase
                const camelKey = key.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
                styleObject[camelKey] = value;
              }
            });
            attrValue = styleObject;
          }
          // Handle data attributes
          else if (attrName.startsWith('data-')) {
            // Keep data attributes as-is
          }
          // Handle boolean attributes
          else if (attrValue === '' || attrValue === attrName) {
            attrValue = true;
          }
          
          props[attrName] = attrValue;
        });

        // Process children, passing the current tag name as parent context
        const children = Array.from(element.childNodes)
          .map((child, i) => convertHtmlToReact(child, i, tagName))
          .filter(child => child !== null); // Filter out null nodes (whitespace in tables)

        return React.createElement(tagName, props, ...children);
      }

      return null;
    };

    const reactContent = Array.from(tempDiv.childNodes).map((node, i) => 
      convertHtmlToReact(node, i)
    );

    return <>{reactContent}</>;
  }, [props.source, props.isRenderingInStepContainer, props.isStreaming, props.expanded, pastFileInfoRef]);
  // Note: pastFileInfo is accessed via ref to avoid infinite loops
  // allSymbols is indirectly tracked through props.source changes

  return (
    <div
      className={`styled-markdown-preview px-1 ${props.className || ''}`}
      style={{
        fontSize: `${props.fontSize || getFontSize()}px`,
        backgroundColor: props.useParentBackgroundColor ? '' : vscBackground,
        color: vscForeground,
        lineHeight: 1.6,
        fontFamily: 'var(--vscode-font-family), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      }}
    >
      {renderedContent}
      <style>{`
        .styled-markdown-preview h1, 
        .styled-markdown-preview h2, 
        .styled-markdown-preview h3, 
        .styled-markdown-preview h4, 
        .styled-markdown-preview h5, 
        .styled-markdown-preview h6 {
          margin: 1.5em 0 0.5em;
          font-weight: 600;
          line-height: 1.3;
          color: #159994;
        }

        .styled-markdown-preview h1 {
          font-size: 1.5em;
          border-bottom: 1px solid rgba(21, 153, 148, 0.3);
          padding-bottom: 0.3em;
          margin-top: 0.8em;
        }

        .styled-markdown-preview h2 {
          font-size: 1.3em;
          border-bottom: 1px solid rgba(21, 153, 148, 0.2);
          padding-bottom: 0.2em;
        }

        .styled-markdown-preview h3 {
          font-size: 1.15em;
        }

        .styled-markdown-preview h4 {
          font-size: 1.05em;
        }

        .styled-markdown-preview h5 {
          font-size: 0.95em;
        }

        .styled-markdown-preview h6 {
          font-size: 0.9em;
          color: rgba(21, 153, 148, 0.9);
        }

        .styled-markdown-preview pre {
          white-space: ${codeWrapState};
          background-color: ${vscEditorBackground};
          border-radius: 0.375rem;
          max-width: calc(100vw - 24px);
          overflow-x: auto;
          overflow-y: hidden;
          padding: 0px 8px;
        }

        .styled-markdown-preview code span.line:empty {
          display: none;
        }
        
        .styled-markdown-preview code {
          word-wrap: break-word;
          border-radius: 0.375rem;
          background-color: ${vscEditorBackground};
          font-size: ${getFontSize() - 2}px;
          font-family: var(--vscode-editor-font-family);
        }

        .styled-markdown-preview code:not(pre > code) {
          font-family: var(--vscode-editor-font-family);
          color: #159994;
          padding: 0.2em 0.4em;
          border-radius: 3px;
          background-color: rgba(21, 153, 148, 0.08);
        }

        .styled-markdown-preview p, 
        .styled-markdown-preview li, 
        .styled-markdown-preview ol, 
        .styled-markdown-preview ul {
          margin: 0.5em 0;
          line-height: 1.6;
        }
        
        .styled-markdown-preview p {
          margin-bottom: 1em;
        }

        .styled-markdown-preview ul, 
        .styled-markdown-preview ol {
          padding-left: 1.5em;
        }
        
        .styled-markdown-preview ul {
          list-style-type: disc;
        }
        
        .styled-markdown-preview ol {
          list-style-type: decimal;
        }
        
        .styled-markdown-preview ul ul {
          list-style-type: circle;
        }
        
        .styled-markdown-preview ul ul ul {
          list-style-type: square;
        }
        
        .styled-markdown-preview li {
          margin: 0.3em 0;
          padding-left: 0.3em;
        }
        
        .styled-markdown-preview li::marker {
          color: #159994;
        }

        .styled-markdown-preview blockquote {
          margin: 1em 0;
          padding: 0.5em 1em;
          border-left: 3px solid #159994;
          background: rgba(21, 153, 148, 0.1);
          border-radius: 4px;
        }

        .styled-markdown-preview a {
          color: #159994;
          text-decoration: none;
          transition: all 0.2s ease;
        }
        
        .styled-markdown-preview a:hover {
          color: #1cc1bb;
          text-decoration: underline;
        }

        .styled-markdown-preview img {
          max-width: 100%;
          border-radius: 8px;
          margin: 1em 0;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
          display: block;
        }

        .styled-markdown-preview table {
          border-collapse: collapse;
          margin: 1em 0;
          width: 100%;
          border-radius: 4px;
          overflow: hidden;
        }

        .styled-markdown-preview th, 
        .styled-markdown-preview td {
          border: 1px solid rgba(255, 255, 255, 0.15);
          padding: 0.7em;
          text-align: left;
        }

        .styled-markdown-preview th {
          background: rgba(21, 153, 148, 0.15);
          font-weight: 600;
          color: #159994;
        }

        .styled-markdown-preview tr:nth-child(even) {
          background: rgba(255, 255, 255, 0.05);
        }
        
        .styled-markdown-preview tr:hover {
          background: rgba(21, 153, 148, 0.07);
        }

        .styled-markdown-preview > *:first-child {
          margin-top: 8px;
        }

        .styled-markdown-preview > *:last-child {
          margin-bottom: 0;
        }
        
        .styled-markdown-preview hr {
          border: 0;
          height: 1px;
          background: rgba(21, 153, 148, 0.3);
          margin: 1.5em 0;
        }
        
        .styled-markdown-preview kbd {
          background-color: rgba(21, 153, 148, 0.1);
          border: 1px solid rgba(21, 153, 148, 0.3);
          border-radius: 3px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
          color: #159994;
          display: inline-block;
          font-size: 0.85em;
          line-height: 1;
          padding: 0.2em 0.4em;
        }

        /* Streaming code block cursor animation */
        .styled-markdown-preview code.generating::after {
          content: '';
          display: inline-block;
          width: 2px;
          height: 1.1em;
          background-color: #159994;
          animation: code-cursor-blink 1s step-end infinite;
          margin-left: 1px;
          vertical-align: text-bottom;
        }

        @keyframes code-cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        /* Subtle pulse effect for generating code blocks */
        .styled-markdown-preview pre[data-generating="true"] {
          position: relative;
        }

        .styled-markdown-preview pre[data-generating="true"]::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, #159994, transparent);
          background-size: 200% 100%;
          animation: code-generating-gradient 2s linear infinite;
        }

        @keyframes code-generating-gradient {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
});

export default StyledMarkdownPreview;
