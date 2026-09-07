/**
 * Converts a flat list of file paths into a tree structure string
 * Similar to the `tree` command output
 */

// ANSI color codes for One Dark Pro theme
const COLORS = {
  reset: '\x1b[0m',
  // Directories - Blue
  directory: '\x1b[38;2;97;175;239m', // #61afef
  // Tree connectors - Dim gray
  connector: '\x1b[38;2;92;99;112m', // #5c6370
  // File types
  typescript: '\x1b[38;2;86;182;194m', // #56b6c2 (cyan)
  javascript: '\x1b[38;2;229;192;123m', // #e5c07b (yellow)
  json: '\x1b[38;2;152;195;121m', // #98c379 (green)
  markdown: '\x1b[38;2;171;178;191m', // #abb2bf (white)
  css: '\x1b[38;2;198;120;221m', // #c678dd (magenta)
  html: '\x1b[38;2;224;108;117m', // #e06c75 (red)
  rust: '\x1b[38;2;224;108;117m', // #e06c75 (red)
  python: '\x1b[38;2;152;195;121m', // #98c379 (green)
  config: '\x1b[38;2;92;99;112m', // #5c6370 (dim)
  default: '\x1b[38;2;171;178;191m', // #abb2bf (white)
};

function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const name = filename.toLowerCase();
  
  // Config files
  if (name.includes('config') || name.includes('rc') || name === 'package.json' || 
      name === 'tsconfig.json' || name === '.gitignore' || name === '.env') {
    return COLORS.config;
  }
  
  switch (ext) {
    case 'ts':
    case 'tsx':
      return COLORS.typescript;
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return COLORS.javascript;
    case 'json':
      return COLORS.json;
    case 'md':
    case 'mdx':
      return COLORS.markdown;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return COLORS.css;
    case 'html':
    case 'htm':
      return COLORS.html;
    case 'rs':
    case 'toml':
      return COLORS.rust;
    case 'py':
    case 'pyi':
      return COLORS.python;
    default:
      return COLORS.default;
  }
}

export function repoMapToTree(repoMapContent: string): string {
  const result = repoMapToTreeColorized(repoMapContent);
  return result.plain;
}

export function repoMapToTreeColorized(repoMapContent: string): { plain: string; colorized: string } {
  if (!repoMapContent || !repoMapContent.trim()) {
    return { plain: "", colorized: "" };
  }

  // Split by lines and filter out empty lines and preamble
  const lines = repoMapContent.split('\n').filter(line => {
    const trimmed = line.trim();
    // Skip empty lines and preamble text
    return trimmed && 
           !trimmed.startsWith('Below is a repository map') &&
           !trimmed.startsWith('For each file') &&
           !trimmed.startsWith('this map contains');
  });

  if (lines.length === 0) {
    return { plain: "", colorized: "" };
  }

  // Build a tree structure from file paths
  interface TreeNode {
    name: string;
    children: Map<string, TreeNode>;
    isFile: boolean;
  }

  const root: TreeNode = {
    name: '',
    children: new Map(),
    isFile: false,
  };

  // Parse each file path and build the tree
  for (const line of lines) {
    const path = line.trim();
    if (!path) continue;

    const parts = path.split('/').filter(p => p);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          children: new Map(),
          isFile,
        });
      }

      current = current.children.get(part)!;
    }
  }

  // Convert tree to string representation
  function treeToString(node: TreeNode, prefix: string = '', isLast: boolean = true, isRoot: boolean = false): { plain: string[]; colorized: string[] } {
    const plainResult: string[] = [];
    const colorizedResult: string[] = [];
    
    // Only print node name if it's not the root
    if (node.name && !isRoot) {
      const connector = isLast ? '└── ' : '├── ';
      const coloredConnector = `${COLORS.connector}${connector}${COLORS.reset}`;
      
      if (node.isFile) {
        const fileColor = getFileColor(node.name);
        plainResult.push(prefix + connector + node.name);
        colorizedResult.push(prefix.replace(/[│├└─]/g, (m) => `${COLORS.connector}${m}${COLORS.reset}`) + coloredConnector + `${fileColor}${node.name}${COLORS.reset}`);
      } else {
        // Directory with trailing /
        plainResult.push(prefix + connector + node.name + '/');
        colorizedResult.push(prefix.replace(/[│├└─]/g, (m) => `${COLORS.connector}${m}${COLORS.reset}`) + coloredConnector + `${COLORS.directory}${node.name}/${COLORS.reset}`);
      }
    }

    const children = Array.from(node.children.values()).sort((a, b) => {
      // Directories first, then files, both alphabetically
      if (a.isFile !== b.isFile) {
        return a.isFile ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const isLastChild = i === children.length - 1;
      const newPrefix = isRoot 
        ? prefix
        : prefix + (isLast ? '    ' : '│   ');
      
      const childResult = treeToString(child, newPrefix, isLastChild, false);
      plainResult.push(...childResult.plain);
      colorizedResult.push(...childResult.colorized);
    }

    return { plain: plainResult, colorized: colorizedResult };
  }

  const result = treeToString(root, '', true, true);
  return {
    plain: result.plain.join('\n'),
    colorized: result.colorized.join('\n'),
  };
}

