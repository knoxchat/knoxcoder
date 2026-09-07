/**
 * File Templates System
 * Provides templates for common file types to accelerate development
 */

export interface TemplateContext {
  filename: string;
  basename: string;
  className?: string;
  componentName?: string;
  packageName?: string;
  moduleName?: string;
  author?: string;
  date?: string;
}

export type TemplateGenerator = (context: TemplateContext) => string;

/**
 * Convert filename to PascalCase for class/component names
 */
function toPascalCase(str: string): string {
  return str
    .replace(/[-_.](.)/g, (_, char) => char.toUpperCase())
    .replace(/^(.)/, (_, char) => char.toUpperCase())
    .replace(/\.[^.]*$/, ''); // Remove extension
}

/**
 * Convert filename to camelCase
 */
function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Get base name without extension
 */
function getBaseName(filename: string): string {
  return filename.replace(/\.[^.]*$/, '');
}

/**
 * Create template context from filename
 */
export function createTemplateContext(filepath: string): TemplateContext {
  const parts = filepath.split('/');
  const filename = parts[parts.length - 1];
  const basename = getBaseName(filename);
  
  return {
    filename,
    basename,
    className: toPascalCase(basename),
    componentName: toPascalCase(basename),
    moduleName: toCamelCase(basename),
    packageName: parts.length > 1 ? parts[parts.length - 2] : 'main',
    author: process.env.USER || 'Developer',
    date: new Date().toISOString().split('T')[0]
  };
}

/**
 * Template definitions
 */
export const FILE_TEMPLATES: Record<string, TemplateGenerator> = {
  // TypeScript templates
  'typescript-react': (ctx) => `import React from 'react';

interface ${ctx.componentName}Props {
  // Add your props here
}

export const ${ctx.componentName}: React.FC<${ctx.componentName}Props> = (props) => {
  return (
    <div className="${ctx.moduleName}">
      <h1>${ctx.componentName}</h1>
    </div>
  );
};

export default ${ctx.componentName};
`,

  'typescript-class': (ctx) => `/**
 * ${ctx.className}
 * Created on ${ctx.date}
 */

export class ${ctx.className} {
  constructor() {
    // Initialize your class
  }

  // Add your methods here
}

export default ${ctx.className};
`,

  'typescript-interface': (ctx) => `/**
 * ${ctx.className} interface
 * Created on ${ctx.date}
 */

export interface ${ctx.className} {
  // Define your interface properties
  id: string;
  name: string;
}

export default ${ctx.className};
`,

  'typescript-function': (ctx) => `/**
 * ${ctx.moduleName}
 * Created on ${ctx.date}
 */

export function ${ctx.moduleName}() {
  // Implement your function
}

export default ${ctx.moduleName};
`,

  // JavaScript templates
  'javascript-react': (ctx) => `import React from 'react';

export const ${ctx.componentName} = (props) => {
  return (
    <div className="${ctx.moduleName}">
      <h1>${ctx.componentName}</h1>
    </div>
  );
};

export default ${ctx.componentName};
`,

  'javascript-module': (ctx) => `/**
 * ${ctx.basename}
 * Created on ${ctx.date}
 */

export function ${ctx.moduleName}() {
  // Implement your function
}

export default ${ctx.moduleName};
`,

  // Python templates
  'python-script': (ctx) => `#!/usr/bin/env python3
"""
${ctx.basename}
Created on ${ctx.date}
"""

def main():
    """Main entry point."""
    pass

if __name__ == "__main__":
    main()
`,

  'python-class': (ctx) => `"""
${ctx.className} module
Created on ${ctx.date}
"""

class ${ctx.className}:
    """${ctx.className} class."""
    
    def __init__(self):
        """Initialize ${ctx.className}."""
        pass
    
    def __str__(self):
        """String representation."""
        return f"${ctx.className}()"

`,

  // Java templates
  'java-class': (ctx) => `package ${ctx.packageName};

/**
 * ${ctx.className}
 * Created on ${ctx.date}
 */
public class ${ctx.className} {
    
    public ${ctx.className}() {
        // Constructor
    }
    
    public static void main(String[] args) {
        // Main method
    }
}
`,

  // Rust templates
  'rust-module': (ctx) => `//! ${ctx.basename} module.

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ${ctx.className};

impl ${ctx.className} {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_is_default() {
        assert_eq!(${ctx.className}::new(), ${ctx.className}::default());
    }
}
`,

  // Go templates
  'go-package': (ctx) => `package ${ctx.moduleName}

// ${ctx.className} represents...
type ${ctx.className} struct {
	// Add your fields here
}

// New${ctx.className} creates a new ${ctx.className}
func New${ctx.className}() *${ctx.className} {
	return &${ctx.className}{
		// Initialize fields
	}
}
`,

  // Markdown templates
  'markdown': (ctx) => `# ${ctx.basename}

## Overview

## Usage

## Features

## Installation

## License
`,

  // HTML templates
  'html': (ctx) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${ctx.basename}</title>
</head>
<body>
    <h1>${ctx.basename}</h1>
    
    <script>
        // Add your JavaScript here
    </script>
</body>
</html>
`,

  // CSS templates
  'css': (ctx) => `/**
 * ${ctx.basename} styles
 * Created on ${ctx.date}
 */

.${ctx.moduleName} {
  /* Add your styles here */
}
`,

  // JSON templates
  'json': () => `{
  "name": "",
  "version": "1.0.0",
  "description": ""
}
`,

  // YAML templates
  'yaml': () => `# Configuration file
# Created on ${new Date().toISOString().split('T')[0]}

name: ""
version: "1.0.0"
`,

  // Dockerfile templates
  'dockerfile': () => `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
`,

  // .gitignore templates
  'gitignore': () => `# Dependencies
node_modules/
vendor/

# Build outputs
dist/
build/
*.o
*.so
*.exe

# Environment
.env
.env.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
logs/
*.log
npm-debug.log*
`,

  // Test templates
  'test-vitest': (ctx) => `import { describe, it, expect } from 'vitest';
import { ${ctx.moduleName} } from './${ctx.basename}';

describe('${ctx.componentName}', () => {
  it('should work correctly', () => {
    // Add your test
    expect(true).toBe(true);
  });
});
`,

  // Config templates
  'config-eslint': () => `module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // Add your rules here
  },
};
`,

  'config-prettier': () => `{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
`,

  'config-tsconfig': () => `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020"],
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`,
};

/**
 * Get template by name
 */
export function getTemplate(templateName: string, filepath: string): string | null {
  if (templateName === 'none' || !templateName) {
    return null;
  }

  const generator = FILE_TEMPLATES[templateName];
  if (!generator) {
    return null;
  }

  const context = createTemplateContext(filepath);
  return generator(context);
}

/**
 * Auto-detect template from file extension
 */
export function detectTemplateFromExtension(filepath: string): string | null {
  const ext = filepath.split('.').pop()?.toLowerCase();
  
  const extensionMap: Record<string, string> = {
    'tsx': 'typescript-react',
    'jsx': 'javascript-react',
    'ts': 'typescript-function',
    'js': 'javascript-module',
    'py': 'python-script',
    'java': 'java-class',
    'rs': 'rust-module',
    'go': 'go-package',
    'md': 'markdown',
    'html': 'html',
    'css': 'css',
    'json': 'json',
    'yml': 'yaml',
    'yaml': 'yaml',
  };

  // Special filename matches
  if (filepath.toLowerCase().endsWith('dockerfile')) {
    return 'dockerfile';
  }
  if (filepath.toLowerCase().endsWith('.gitignore')) {
    return 'gitignore';
  }
  if (filepath.toLowerCase().includes('.test.') || filepath.toLowerCase().includes('.spec.')) {
    if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
      return 'test-vitest';
    }
  }
  if (filepath.toLowerCase().endsWith('.eslintrc.js') || filepath.toLowerCase().endsWith('.eslintrc.cjs')) {
    return 'config-eslint';
  }
  if (filepath.toLowerCase().endsWith('.prettierrc') || filepath.toLowerCase().endsWith('.prettierrc.json')) {
    return 'config-prettier';
  }
  if (filepath.toLowerCase().endsWith('tsconfig.json')) {
    return 'config-tsconfig';
  }

  return ext ? extensionMap[ext] || null : null;
}

/**
 * Get language ID from file extension
 */
export function detectLanguageFromExtension(filepath: string): string {
  const ext = filepath.split('.').pop()?.toLowerCase();
  
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescriptreact',
    'js': 'javascript',
    'jsx': 'javascriptreact',
    'py': 'python',
    'java': 'java',
    'rs': 'rust',
    'go': 'go',
    'c': 'c',
    'cpp': 'cpp',
    'cs': 'csharp',
    'rb': 'ruby',
    'php': 'php',
    'sh': 'shellscript',
    'bash': 'shellscript',
    'zsh': 'shellscript',
    'md': 'markdown',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'json': 'json',
    'xml': 'xml',
    'yml': 'yaml',
    'yaml': 'yaml',
    'sql': 'sql',
    'dockerfile': 'dockerfile',
  };

  if (filepath.toLowerCase().endsWith('dockerfile')) {
    return 'dockerfile';
  }

  return ext ? languageMap[ext] || 'plaintext' : 'plaintext';
}
