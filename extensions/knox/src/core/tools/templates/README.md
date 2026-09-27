# Enhanced Create New File Tool

## Overview

The enhanced `createNewFile` tool provides a powerful and intelligent file creation system with template support, auto-detection, and smart defaults.

## Key Features

### 1. **Template Support**
Automatically generate boilerplate code for common file types:
- TypeScript (React components, classes, interfaces, functions)
- JavaScript (React components, modules)
- Python (scripts, classes)
- Java, Rust, Go
- Config files (ESLint, Prettier, TSConfig)
- Test files (Vitest)
- And many more...

### 2. **Auto-Detection**
- Automatically detects file type from extension
- Suggests appropriate templates
- Detects language for syntax highlighting
- Smart naming conventions (PascalCase for classes, camelCase for functions)

### 3. **Smart Directory Handling**
- Creates parent directories automatically (optional)
- Validates file paths
- Prevents accidental overwrites (unless explicitly allowed)

### 4. **Flexible Content**
- Use templates for quick scaffolding
- Provide custom content
- Mix both (template with customization)
- Support for empty files

### 5. **Enhanced Error Handling**
- Clear error messages
- Validation of parameters
- Existence checking before creation
- Encoding validation

## Usage Examples

### Basic File Creation

```typescript
// Create a simple text file
{
  "filepath": "docs/README.md",
  "contents": "# My Project\n\nThis is my project."
}
```

### Using Templates

```typescript
// Create a React component with template
{
  "filepath": "src/components/Button.tsx",
  "template": "typescript-react"
}
// Generates:
// - Proper TypeScript React component
// - Props interface
// - Export statements
```

### Auto-Template Detection

```typescript
// Just specify the path, template auto-detected
{
  "filepath": "src/utils/helper.ts",
  "contents": "" // Empty triggers auto-detection
}
// Automatically uses 'typescript-function' template
```

### Advanced Options

```typescript
{
  "filepath": "deep/nested/path/Component.tsx",
  "template": "typescript-react",
  "openAfterCreate": true,
  "createDirectories": true,
  "overwrite": false,
  "language": "typescriptreact"
}
```

## Available Templates

### TypeScript
- `typescript-react` - React functional component with TypeScript
- `typescript-class` - TypeScript class with JSDoc
- `typescript-interface` - TypeScript interface definition
- `typescript-function` - Exported function with JSDoc

### JavaScript
- `javascript-react` - React functional component
- `javascript-module` - ES module with export

### Python
- `python-script` - Script with main function
- `python-class` - Class with docstrings

### Other Languages
- `java-class` - Java class with main method
- `rust-module` - Rust module with tests
- `go-package` - Go package with constructor

### Markup & Config
- `markdown` - Markdown document structure
- `html` - HTML5 boilerplate
- `css` - CSS file with header
- `json` - Basic JSON structure
- `yaml` - YAML configuration
- `dockerfile` - Docker container definition
- `gitignore` - Common .gitignore patterns

### Testing
- `test-vitest` - Vitest test file

### Configuration
- `config-eslint` - ESLint configuration
- `config-prettier` - Prettier configuration
- `config-tsconfig` - TypeScript configuration

## Parameters

### Required
- **filepath** (string): Path relative to workspace root
  - Example: `"src/components/Button.tsx"`
  - Supports nested paths: `"deep/path/to/file.ts"`

- **contents** (string): File content
  - Can be empty string to use template
  - Overrides template if provided

### Optional
- **template** (string): Template to use
  - Default: `"none"`
  - Set to template name for boilerplate
  - Auto-detected if contents empty

- **openAfterCreate** (boolean): Open file after creation
  - Default: `true`
  - Set to `false` to create without opening

- **createDirectories** (boolean): Create parent directories
  - Default: `true`
  - Set to `false` to require existing directories

- **overwrite** (boolean): Overwrite existing file
  - Default: `false`
  - Set to `true` to replace existing files

- **encoding** (string): File encoding
  - Default: `"utf-8"`
  - Options: `utf8`, `utf-8`, `ascii`, `base64`, `binary`

- **language** (string): Language identifier
  - Auto-detected from extension if not provided
  - Used for syntax highlighting

## Template Context

Templates have access to smart naming:

```typescript
// For file: src/components/user-profile.tsx
{
  filename: "user-profile.tsx",
  basename: "user-profile",
  className: "UserProfile",      // PascalCase
  componentName: "UserProfile",  // PascalCase
  moduleName: "userProfile",     // camelCase
  packageName: "components",     // Parent directory
  author: "Developer",
  date: "2026-01-10"
}
```

## Error Handling

The tool provides clear error messages:

```typescript
// File already exists
"File 'src/App.tsx' already exists. Use overwrite: true to replace it..."

// Invalid path
"Failed to resolve file path..."

// Missing directories (when createDirectories: false)
"Parent directory does not exist..."

// Invalid encoding
"Invalid encoding: utf16. Valid encodings are: utf8, utf-8, ascii..."
```

## Best Practices

1. **Use Templates for Standard Files**
   - Leverage templates for consistent code structure
   - Customize generated code as needed

2. **Let Auto-Detection Work**
   - Omit template parameter for auto-detection
   - Works great for common file types

3. **Validate Before Overwriting**
   - Default `overwrite: false` prevents accidents
   - Use edit tools for modifying existing files

4. **Nested Structures**
   - Let the tool create directories automatically
   - Focus on file content, not path creation

5. **Empty Files**
   - Use empty `contents: ""` to trigger template
   - Or provide `contents` to skip template

## Integration with VS Code

The tool integrates seamlessly:
- Files open in editor automatically
- Proper syntax highlighting applied
- Language detection for IntelliSense
- Directory structure visible in explorer

## Performance

- **Fast**: Direct file system access
- **Efficient**: Minimal validation overhead
- **Smart**: Only creates what's needed
- **Safe**: Validates before writing

## Future Enhancements

Potential additions:
- Custom template registry
- Project-specific templates
- Template variables from config
- Multi-file scaffolding
- Template marketplace

## See Also

- [File Templates Documentation](./fileTemplates.ts)
- [Tool Implementation](../implementations/createNewFile.ts)
- [Tool Definition](../definitions/createNewFile.ts)
