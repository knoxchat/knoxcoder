import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import FileIcon from "../FileIcon";

interface FileSnapshot {
  relativePath: string;
  content: string;
  encoding: string;
  lastModified: string;
  size: number;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  fileData?: FileSnapshot;
}

interface FileTreeViewProps {
  files: FileSnapshot[];
  onFileSelect: (file: FileSnapshot) => void;
  selectedFile?: FileSnapshot;
}

// Internal type for building the tree
interface FileTreeNodeInternal {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: { [key: string]: FileTreeNodeInternal };
  fileData?: FileSnapshot;
}

// Build tree structure from flat file list
function buildFileTree(files: FileSnapshot[]): FileTreeNode[] {
  const root: { [key: string]: FileTreeNodeInternal } = {};

  files.forEach(file => {
    const pathParts = file.relativePath.split('/').filter(Boolean);
    let currentLevel = root;
    let currentPath = '';

    pathParts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === pathParts.length - 1;

      if (!currentLevel[part]) {
        currentLevel[part] = {
          name: part,
          path: currentPath,
          isDirectory: !isFile,
          children: isFile ? undefined : {},
          fileData: isFile ? file : undefined,
        };
      }

      if (!isFile && currentLevel[part].children) {
        currentLevel = currentLevel[part].children!;
      }
    });
  });

  // Convert to array and sort
  function convertToArray(obj: { [key: string]: FileTreeNodeInternal }): FileTreeNode[] {
    return Object.values(obj)
      .map(node => ({
        name: node.name,
        path: node.path,
        isDirectory: node.isDirectory,
        fileData: node.fileData,
        children: node.children ? convertToArray(node.children) : undefined,
      }))
      .sort((a, b) => {
        // Directories first, then files
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  }

  return convertToArray(root);
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  onFileSelect: (file: FileSnapshot) => void;
  selectedFile?: FileSnapshot;
  expandedNodes: Set<string>;
  onToggleExpand: (path: string) => void;
}

function TreeNode({ 
  node, 
  depth, 
  onFileSelect, 
  selectedFile, 
  expandedNodes, 
  onToggleExpand 
}: TreeNodeProps) {
  const isExpanded = expandedNodes.has(node.path);
  const isSelected = selectedFile?.relativePath === node.path;

  const handleClick = () => {
    if (node.isDirectory) {
      onToggleExpand(node.path);
    } else if (node.fileData) {
      onFileSelect(node.fileData);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center py-0.5 px-1 cursor-pointer hover:bg-muted/40 transition-colors text-xs leading-tight",
          isSelected && "bg-primary/10 border-l-2 border-primary"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
      >
        <div className="flex items-center gap-0.5 flex-1 min-w-0">
          {node.isDirectory ? (
            <>
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="w-3 h-3 text-knoxcyan flex-shrink-0 ml-0.5" />
              ) : (
                <Folder className="w-3 h-3 text-knoxcyan flex-shrink-0 ml-0.5" />
              )}
            </>
          ) : (
            <>
              <div className="w-3 h-3 flex-shrink-0" /> {/* Spacer for alignment */}
              <div className="ml-0.5">
                <FileIcon height="12px" width="12px" filename={node.name} />
              </div>
            </>
          )}
          <span className="truncate text-foreground ml-1 font-normal">
            {node.name}
          </span>
        </div>
      </div>

      {node.isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function FileTreeView({ files, onFileSelect, selectedFile }: FileTreeViewProps) {
  const { t } = useTranslation();
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const tree = buildFileTree(files);

  const handleToggleExpand = (path: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedNodes(newExpanded);
  };

  // Auto-expand to show first file if nothing is selected
  React.useEffect(() => {
    if (files.length > 0 && expandedNodes.size === 0) {
      const firstFile = files[0];
      const pathParts = firstFile.relativePath.split('/');
      const newExpanded = new Set<string>();
      
      let currentPath = '';
      pathParts.slice(0, -1).forEach(part => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        newExpanded.add(currentPath);
      });
      
      setExpandedNodes(newExpanded);
      
      // Auto-select first file
      if (!selectedFile) {
        onFileSelect(firstFile);
      }
    }
  }, [files, selectedFile, expandedNodes.size, onFileSelect]);

  if (files.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        {t('noFilesInCheckpoint')}
      </div>
    );
  }

  return (
    <div className="border bg-background h-full flex flex-col">
      <div className="px-2 py-1 border-b bg-muted/20 flex-shrink-0">
        <div className="text-xs font-medium text-muted-foreground">
          {t('fileCount', { count: files.length })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tree.map(node => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            onFileSelect={onFileSelect}
            selectedFile={selectedFile}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </div>
    </div>
  );
}
