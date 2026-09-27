/**
 * Enhanced Create New File Tool - Usage Examples
 * 
 * This file demonstrates various ways to use the enhanced createNewFile tool
 */

// Example 1: Basic file creation with custom content
const example1 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/utils/logger.ts",
      contents: `export function log(message: string) {
  console.log(\`[\${new Date().toISOString()}] \${message}\`);
}`
    }
  },
  description: "Creates a simple TypeScript file with custom content"
};

// Example 2: Using templates - React Component
const example2 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/components/Dashboard.tsx",
      template: "typescript-react"
    }
  },
  description: "Auto-generates a TypeScript React component with proper structure",
  expectedOutput: `import React from 'react';

interface DashboardProps {
  // Add your props here
}

export const Dashboard: React.FC<DashboardProps> = (props) => {
  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
    </div>
  );
};

export default Dashboard;`
};

// Example 3: Auto-detection from file extension
const example3 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/services/api.ts",
      contents: "" // Empty contents triggers auto-detection
    }
  },
  description: "Automatically detects .ts extension and uses typescript-function template"
};

// Example 4: Creating test files
const example4 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/components/Dashboard.test.tsx",
      template: "test-vitest"
    }
  },
  description: "Creates a Vitest test file with proper imports and structure"
};

// Example 5: Configuration files
const example5 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: ".prettierrc",
      template: "config-prettier"
    }
  },
  description: "Creates a Prettier configuration with sensible defaults"
};

// Example 6: Python script
const example6 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "scripts/deploy.py",
      template: "python-script"
    }
  },
  description: "Creates a Python script with shebang and main function"
};

// Example 7: Nested directory creation
const example7 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/features/auth/components/LoginForm.tsx",
      template: "typescript-react",
      createDirectories: true
    }
  },
  description: "Creates file and all parent directories automatically"
};

// Example 8: Overwriting existing file
const example8 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/config/index.ts",
      contents: "export const API_URL = 'https://api.example.com';",
      overwrite: true
    }
  },
  description: "Overwrites existing file (use with caution)"
};

// Example 9: Create without opening
const example9 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "logs/app.log",
      contents: "",
      openAfterCreate: false
    }
  },
  description: "Creates file but doesn't open it in editor"
};

// Example 10: Markdown documentation
const example10 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "docs/API.md",
      template: "markdown"
    }
  },
  description: "Creates structured Markdown documentation"
};

// Example 11: Dockerfile
const example11 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "Dockerfile",
      template: "dockerfile"
    }
  },
  description: "Creates a Dockerfile with Node.js base"
};

// Example 12: .gitignore
const example12 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: ".gitignore",
      template: "gitignore"
    }
  },
  description: "Creates comprehensive .gitignore with common patterns"
};

// Example 13: TypeScript interface
const example13 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/types/User.ts",
      template: "typescript-interface"
    }
  },
  description: "Creates a TypeScript interface definition"
};

// Example 14: Rust module
const example14 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/utils.rs",
      template: "rust-module"
    }
  },
  description: "Creates Rust module with struct, impl, and tests"
};

// Example 15: Custom encoding
const example15 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "data/config.txt",
      contents: "Configuration data",
      encoding: "ascii"
    }
  },
  description: "Creates file with ASCII encoding"
};

// Example 16: Mixing template with custom name
const example16 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/hooks/use-local-storage.ts",
      template: "typescript-function"
    }
  },
  description: "Template adapts to kebab-case filename, generates useLocalStorage"
};

// Example 17: Complex React component path
const example17 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/features/dashboard/components/widgets/chart-widget.tsx",
      template: "typescript-react"
    }
  },
  description: "Creates deeply nested component, generates ChartWidget component"
};

// Example 18: Go package
const example18 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "internal/handler/user.go",
      template: "go-package"
    }
  },
  description: "Creates Go package with type and constructor"
};

// Example 19: Empty file for later
const example19 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "TODO.md",
      contents: ""
    }
  },
  description: "Creates empty file, auto-detects markdown template"
};

// Example 20: Full control
const example20 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/custom/special.ts",
      contents: "// Custom implementation\nexport const special = 42;",
      openAfterCreate: true,
      createDirectories: true,
      overwrite: false,
      encoding: "utf-8",
      language: "typescript"
    }
  },
  description: "Uses all parameters for complete control"
};

// Error Handling Examples

// Will fail: File already exists
const errorExample1 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "src/App.tsx", // Assuming this exists
      contents: "new content"
      // Missing: overwrite: true
    }
  },
  expectedError: "File 'src/App.tsx' already exists. Use overwrite: true to replace it..."
};

// Will fail: Invalid encoding
const errorExample2 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "test.txt",
      contents: "content",
      encoding: "invalid-encoding"
    }
  },
  expectedError: "Invalid encoding: invalid-encoding. Valid encodings are: utf8, utf-8, ascii, base64, binary"
};

// Will fail: Empty filepath
const errorExample3 = {
  toolCall: {
    function: "builtin_create_new_file",
    arguments: {
      filepath: "",
      contents: "content"
    }
  },
  expectedError: "Filepath cannot be empty"
};

// Success Pattern Examples
const successPatterns = {
  // Pattern 1: Quick component creation
  quickComponent: {
    filepath: "src/components/Alert.tsx",
    template: "typescript-react"
  },
  
  // Pattern 2: Test alongside component
  componentTest: {
    filepath: "src/components/Alert.test.tsx",
    template: "test-vitest"
  },
  
  // Pattern 3: Utility with implementation
  utilityFunction: {
    filepath: "src/utils/debounce.ts",
    contents: `export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}`
  },
  
  // Pattern 4: Config from template
  configFile: {
    filepath: "tsconfig.json",
    template: "config-tsconfig"
  }
};

export {
  example1,
  example2,
  example3,
  example4,
  example5,
  example6,
  example7,
  example8,
  example9,
  example10,
  example11,
  example12,
  example13,
  example14,
  example15,
  example16,
  example17,
  example18,
  example19,
  example20,
  errorExample1,
  errorExample2,
  errorExample3,
  successPatterns
};
