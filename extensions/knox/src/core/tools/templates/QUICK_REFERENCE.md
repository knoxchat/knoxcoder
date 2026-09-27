# Create New File Tool - Quick Reference

## Basic Usage

```json
{
  "filepath": "path/to/file.ext",
  "contents": "your content here"
}
```

## Template Usage

```json
{
  "filepath": "src/components/Button.tsx",
  "template": "typescript-react"
}
```

## Common Templates

| Template | Use For | Example |
|----------|---------|---------|
| `typescript-react` | React components | `Button.tsx` |
| `typescript-class` | TypeScript classes | `UserService.ts` |
| `typescript-function` | Utility functions | `formatDate.ts` |
| `javascript-react` | React components (JS) | `Button.jsx` |
| `python-script` | Python scripts | `main.py` |
| `python-class` | Python classes | `User.py` |
| `java-class` | Java classes | `User.java` |
| `rust-module` | Rust modules | `utils.rs` |
| `go-package` | Go packages | `handler.go` |
| `markdown` | Documentation | `README.md` |
| `test-vitest` | Vitest tests | `Button.test.ts` |
| `config-eslint` | ESLint config | `.eslintrc.js` |
| `dockerfile` | Docker config | `Dockerfile` |

## Auto-Detection

Leave `contents` empty and template will be auto-detected:

```json
{
  "filepath": "src/App.tsx",
  "contents": ""
}
```

Maps to `typescript-react` automatically!

## Common Patterns

### Create React Component
```json
{
  "filepath": "src/components/Header.tsx",
  "template": "typescript-react"
}
```

### Create Test File
```json
{
  "filepath": "src/components/Header.test.tsx",
  "template": "test-vitest"
}
```

### Create Utility Function
```json
{
  "filepath": "src/utils/api.ts",
  "template": "typescript-function"
}
```

### Create Config File
```json
{
  "filepath": ".prettierrc",
  "template": "config-prettier"
}
```

### Create Empty File
```json
{
  "filepath": "notes.txt",
  "contents": ""
}
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `filepath` | ✅ Yes | - | Path relative to workspace |
| `contents` | ✅ Yes | - | File content (can be empty) |
| `template` | ❌ No | `"none"` | Template to use |
| `openAfterCreate` | ❌ No | `true` | Open file after creation |
| `createDirectories` | ❌ No | `true` | Create parent directories |
| `overwrite` | ❌ No | `false` | Overwrite existing file |
| `encoding` | ❌ No | `"utf-8"` | File encoding |
| `language` | ❌ No | auto | Language ID |

## Tips

1. **Let it auto-detect**: Empty contents triggers template detection
2. **Safety first**: Default `overwrite: false` prevents accidents
3. **Directories included**: Parent folders created automatically
4. **Smart naming**: Templates use intelligent PascalCase/camelCase
5. **Rich feedback**: Returns file info and preview

## Examples by Language

### TypeScript
```json
{"filepath": "src/models/User.ts", "template": "typescript-class"}
{"filepath": "src/types/index.ts", "template": "typescript-interface"}
{"filepath": "src/App.tsx", "template": "typescript-react"}
```

### JavaScript
```json
{"filepath": "src/utils.js", "template": "javascript-module"}
{"filepath": "src/Button.jsx", "template": "javascript-react"}
```

### Python
```json
{"filepath": "main.py", "template": "python-script"}
{"filepath": "models/user.py", "template": "python-class"}
```

### Config
```json
{"filepath": ".eslintrc.js", "template": "config-eslint"}
{"filepath": ".prettierrc", "template": "config-prettier"}
{"filepath": "tsconfig.json", "template": "config-tsconfig"}
```

### Testing
```json
{"filepath": "Button.test.ts", "template": "test-vitest"}
{"filepath": "utils.spec.ts", "template": "test-vitest"}
```

## Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "File already exists" | File present, no overwrite | Add `"overwrite": true` or edit file |
| "Parent directory does not exist" | Missing folders | Ensure `"createDirectories": true` |
| "Invalid encoding" | Bad encoding value | Use: utf8, ascii, base64, binary |
| "Failed to resolve file path" | Invalid path | Check filepath syntax |

## Advanced Usage

### Overwrite Existing File
```json
{
  "filepath": "src/App.tsx",
  "contents": "new content",
  "overwrite": true
}
```

### Create Without Opening
```json
{
  "filepath": "logs/debug.log",
  "contents": "",
  "openAfterCreate": false
}
```

### Custom Encoding
```json
{
  "filepath": "data/binary.dat",
  "contents": "...",
  "encoding": "binary"
}
```

### Specify Language
```json
{
  "filepath": "config",
  "contents": "...",
  "language": "yaml"
}
```

## See Full Documentation

For complete details, see [README.md](./README.md)
