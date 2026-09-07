import * as path from 'path';
import * as vscode from 'vscode';
import { TextDocument, Position, Range, CancellationToken } from 'vscode';

// Code suggestion types
export enum SuggestionType {
  COMPLETION = 'completion',
  REFACTORING = 'refactoring',
  FIX = 'fix',
  DOCUMENTATION = 'documentation'
}

// Interface for code suggestions
export interface CodeSuggestion {
  id: string;
  type: SuggestionType;
  range: Range;
  text: string;
  description: string;
  confidence: number; // 0-1
}

// Language Server Interface
export interface LanguageServerClient {
  isReady(): boolean;
  getCompletions(document: TextDocument, position: Position, token: CancellationToken): Promise<vscode.CompletionItem[]>;
  getHover(document: TextDocument, position: Position, token: CancellationToken): Promise<vscode.Hover | null>;
  getDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<vscode.Location | null>;
  getReferences(document: TextDocument, position: Position, token: CancellationToken): Promise<vscode.Location[]>;
  getCodeActions(document: TextDocument, range: Range, token: CancellationToken): Promise<vscode.CodeAction[]>;
}

export class CodeIntelligenceService implements vscode.Disposable {
  private static instance: CodeIntelligenceService;
  private disposables: vscode.Disposable[] = [];
  private languageClients: Map<string, LanguageServerClient> = new Map();
  private completionProvider: vscode.Disposable | null = null;
  private hoverProvider: vscode.Disposable | null = null;
  private definitionProvider: vscode.Disposable | null = null;
  private referencesProvider: vscode.Disposable | null = null;
  private codeActionsProvider: vscode.Disposable | null = null;
  
  // Cache for document symbols to improve performance
  private symbolCache: Map<string, vscode.DocumentSymbol[]> = new Map();
  private symbolCacheTimeout: number = 30000; // 30 seconds
  
  // Suggestion storage
  private suggestions: Map<string, CodeSuggestion[]> = new Map();
  
  // Event emitter for suggestion updates
  private _onSuggestionsUpdated = new vscode.EventEmitter<{ uri: vscode.Uri, suggestions: CodeSuggestion[] }>();
  public readonly onSuggestionsUpdated = this._onSuggestionsUpdated.event;

  // Singleton pattern
  public static getInstance(): CodeIntelligenceService {
    if (!CodeIntelligenceService.instance) {
      CodeIntelligenceService.instance = new CodeIntelligenceService();
    }
    return CodeIntelligenceService.instance;
  }

  private constructor() {
    // Register language providers
    this.registerProviders();
    
    // Listen for document changes to update symbol cache
    vscode.workspace.onDidChangeTextDocument(this.onDocumentChanged, this, this.disposables);
    vscode.workspace.onDidCloseTextDocument(this.onDocumentClosed, this, this.disposables);
    
    // Register language clients
    this.registerLanguageClients();
  }
  
  private registerProviders(): void {
    // Register completion provider
    this.completionProvider = vscode.languages.registerCompletionItemProvider(
      { scheme: 'file' },
      {
        provideCompletionItems: async (document, position, token) => {
          return await this.provideCompletionItems(document, position, token);
        }
      }
    );
    this.disposables.push(this.completionProvider);
    
    // Register hover provider
    this.hoverProvider = vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      {
        provideHover: async (document, position, token) => {
          return await this.provideHover(document, position, token);
        }
      }
    );
    this.disposables.push(this.hoverProvider);
    
    // Register definition provider
    this.definitionProvider = vscode.languages.registerDefinitionProvider(
      { scheme: 'file' },
      {
        provideDefinition: async (document, position, token) => {
          return await this.provideDefinition(document, position, token);
        }
      }
    );
    this.disposables.push(this.definitionProvider);
    
    // Register references provider
    this.referencesProvider = vscode.languages.registerReferenceProvider(
      { scheme: 'file' },
      {
        provideReferences: async (document, position, context, token) => {
          return await this.provideReferences(document, position, token);
        }
      }
    );
    this.disposables.push(this.referencesProvider);
    
    // Register code actions provider
    this.codeActionsProvider = vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      {
        provideCodeActions: async (document, range, context, token) => {
          return await this.provideCodeActions(document, range, token);
        }
      }
    );
    this.disposables.push(this.codeActionsProvider);
  }
  
  private registerLanguageClients(): void {
    // Language clients are provided by VS Code's built-in language extensions
    // (TypeScript, Python, etc.). We leverage the VS Code command API to interact
    // with them rather than spawning our own LSP instances.
  }
  
  // Document change handler to update symbol cache
  private onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
    // Clear symbol cache for the changed document
    this.symbolCache.delete(e.document.uri.toString());
    
    // Analyze document for new suggestions
    this.analyzeSuggestions(e.document);
  }
  
  // Document close handler
  private onDocumentClosed(document: vscode.TextDocument): void {
    // Clear symbol cache and suggestions for closed document
    this.symbolCache.delete(document.uri.toString());
    this.suggestions.delete(document.uri.toString());
  }
  
  // Analyze document for possible suggestions
  private async analyzeSuggestions(document: vscode.TextDocument): Promise<void> {
    // Skip analysis for non-code files
    if (!this.isSupportedLanguage(document.languageId)) {
      return;
    }
    
    try {
      // Get document symbols
      const symbols = await this.getDocumentSymbols(document);
      
      // Generate suggestions based on document analysis
      const newSuggestions: CodeSuggestion[] = [];
      
      // Check for unused imports
      const unusedImports = await this.detectUnusedImports(document, symbols);
      for (const importRange of unusedImports) {
        newSuggestions.push({
          id: `unused-import-${Date.now()}-${Math.random()}`,
          type: SuggestionType.FIX,
          range: importRange,
          text: '',
          description: 'Remove unused import',
          confidence: 0.9
        });
      }
      
      // Check for possible refactorings
      const refactoringOptions = await this.detectRefactoringOpportunities(document, symbols);
      for (const option of refactoringOptions) {
        newSuggestions.push(option);
      }
      
      // Store suggestions and emit event
      this.suggestions.set(document.uri.toString(), newSuggestions);
      this._onSuggestionsUpdated.fire({ uri: document.uri, suggestions: newSuggestions });
      
    } catch (error) {
      console.error('Error analyzing document for suggestions:', error);
    }
  }
  
  // Get document symbols with caching
  private async getDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
    const uri = document.uri.toString();
    
    // Check cache
    if (this.symbolCache.has(uri)) {
      return this.symbolCache.get(uri) || [];
    }
    
    // Get symbols from VSCode
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      ) || [];
      
      // Cache symbols
      this.symbolCache.set(uri, symbols);
      
      // Set timeout to clear cache
      setTimeout(() => {
        this.symbolCache.delete(uri);
      }, this.symbolCacheTimeout);
      
      return symbols;
    } catch (error) {
      console.error('Error getting document symbols:', error);
      return [];
    }
  }
  
  // Detect unused imports in the document
  private async detectUnusedImports(document: vscode.TextDocument, symbols: vscode.DocumentSymbol[]): Promise<vscode.Range[]> {
    const text = document.getText();
    const languageId = document.languageId;
    const unusedRanges: vscode.Range[] = [];

    // Extract import statements based on language
    const importRanges: { range: vscode.Range; identifiers: string[] }[] = [];

    if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(languageId)) {
      // Match ES module imports: import { X, Y } from '...'; import X from '...'; import * as X from '...'
      const importRegex = /^import\s+(?:(?:\{([^}]+)\})|(?:\*\s+as\s+(\w+))|(?:(\w+)(?:\s*,\s*\{([^}]+)\})?))\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const identifiers: string[] = [];
        // Named imports: { X, Y as Z }
        if (match[1]) {
          for (const id of match[1].split(',')) {
            const trimmed = id.trim();
            // Handle "X as Y" — the local name is Y
            const asMatch = trimmed.match(/\w+\s+as\s+(\w+)/);
            if (asMatch) {
              identifiers.push(asMatch[1]);
            } else if (trimmed) {
              identifiers.push(trimmed);
            }
          }
        }
        // Namespace import: * as X
        if (match[2]) { identifiers.push(match[2]); }
        // Default import: import X
        if (match[3]) { identifiers.push(match[3]); }
        // Default + named: import X, { Y }
        if (match[4]) {
          for (const id of match[4].split(',')) {
            const trimmed = id.trim();
            const asMatch = trimmed.match(/\w+\s+as\s+(\w+)/);
            if (asMatch) {
              identifiers.push(asMatch[1]);
            } else if (trimmed) {
              identifiers.push(trimmed);
            }
          }
        }

        if (identifiers.length > 0) {
          const startPos = document.positionAt(match.index);
          const endPos = document.positionAt(match.index + match[0].length);
          importRanges.push({ range: new vscode.Range(startPos, endPos), identifiers });
        }
      }
    } else if (languageId === 'python') {
      // Match: from X import Y, Z  or  import X
      const pyImportRegex = /^(?:from\s+\S+\s+import\s+(.+)|import\s+(\S+)(?:\s+as\s+(\w+))?)$/gm;
      let match;
      while ((match = pyImportRegex.exec(text)) !== null) {
        const identifiers: string[] = [];
        if (match[1]) {
          for (const id of match[1].split(',')) {
            const trimmed = id.trim();
            const asMatch = trimmed.match(/\w+\s+as\s+(\w+)/);
            if (asMatch) {
              identifiers.push(asMatch[1]);
            } else if (trimmed) {
              identifiers.push(trimmed);
            }
          }
        } else if (match[3]) {
          identifiers.push(match[3]);
        } else if (match[2]) {
          const parts = match[2].split('.');
          identifiers.push(parts[parts.length - 1]);
        }
        if (identifiers.length > 0) {
          const startPos = document.positionAt(match.index);
          const endPos = document.positionAt(match.index + match[0].length);
          importRanges.push({ range: new vscode.Range(startPos, endPos), identifiers });
        }
      }
    }

    // Check each import's identifiers against the rest of the document
    for (const { range, identifiers } of importRanges) {
      const importLineStart = range.start.line;
      const importLineEnd = range.end.line;
      const allUnused = identifiers.every((id) => {
        // Search for usage of the identifier outside the import line itself
        const idRegex = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        let found;
        while ((found = idRegex.exec(text)) !== null) {
          const pos = document.positionAt(found.index);
          if (pos.line < importLineStart || pos.line > importLineEnd) {
            return false; // used elsewhere
          }
        }
        return true; // never used outside import
      });

      if (allUnused) {
        unusedRanges.push(range);
      }
    }

    return unusedRanges;
  }
  
  // Detect refactoring opportunities
  private async detectRefactoringOpportunities(document: vscode.TextDocument, symbols: vscode.DocumentSymbol[]): Promise<CodeSuggestion[]> {
    const suggestions: CodeSuggestion[] = [];

    for (const symbol of symbols) {
      // Detect long functions (>50 lines) — suggest extraction
      if (
        (symbol.kind === vscode.SymbolKind.Function || symbol.kind === vscode.SymbolKind.Method) &&
        symbol.range.end.line - symbol.range.start.line > 50
      ) {
        suggestions.push({
          id: `long-function-${symbol.name}-${Date.now()}`,
          type: SuggestionType.REFACTORING,
          range: symbol.range,
          text: '',
          description: `Function '${symbol.name}' is ${symbol.range.end.line - symbol.range.start.line} lines long. Consider extracting sub-routines.`,
          confidence: 0.7,
        });
      }

      // Detect deeply nested classes with many methods (>10) — suggest splitting
      if (symbol.kind === vscode.SymbolKind.Class && symbol.children) {
        const methodCount = symbol.children.filter(
          (c) => c.kind === vscode.SymbolKind.Method || c.kind === vscode.SymbolKind.Function,
        ).length;
        if (methodCount > 10) {
          suggestions.push({
            id: `large-class-${symbol.name}-${Date.now()}`,
            type: SuggestionType.REFACTORING,
            range: symbol.range,
            text: '',
            description: `Class '${symbol.name}' has ${methodCount} methods. Consider splitting into smaller classes.`,
            confidence: 0.6,
          });
        }
      }

      // Check children recursively
      if (symbol.children) {
        const childSuggestions = await this.detectRefactoringOpportunities(document, symbol.children);
        suggestions.push(...childSuggestions);
      }
    }

    return suggestions;
  }
  
  // Check if language is supported
  private isSupportedLanguage(languageId: string): boolean {
    const supportedLanguages = [
      'typescript', 'javascript', 'python', 'java', 'csharp',
      'go', 'rust', 'cpp', 'c', 'php', 'ruby'
    ];
    return supportedLanguages.includes(languageId);
  }
  
  // Provider implementation methods
  private async provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): Promise<vscode.CompletionItem[]> {
    const languageId = document.languageId;
    const client = this.languageClients.get(languageId);
    
    if (client && client.isReady()) {
      return await client.getCompletions(document, position, token);
    }
    
    // Fall back to VSCode's built-in completion
    return [];
  }
  
  private async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<vscode.Hover | null> {
    const languageId = document.languageId;
    const client = this.languageClients.get(languageId);
    
    if (client && client.isReady()) {
      return await client.getHover(document, position, token);
    }
    
    return null;
  }
  
  private async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<vscode.Location | null> {
    const languageId = document.languageId;
    const client = this.languageClients.get(languageId);
    
    if (client && client.isReady()) {
      return await client.getDefinition(document, position, token);
    }
    
    return null;
  }
  
  private async provideReferences(document: TextDocument, position: Position, token: CancellationToken): Promise<vscode.Location[]> {
    const languageId = document.languageId;
    const client = this.languageClients.get(languageId);
    
    if (client && client.isReady()) {
      return await client.getReferences(document, position, token);
    }
    
    return [];
  }
  
  private async provideCodeActions(document: TextDocument, range: Range, token: CancellationToken): Promise<vscode.CodeAction[]> {
    const languageId = document.languageId;
    const client = this.languageClients.get(languageId);
    
    if (client && client.isReady()) {
      return await client.getCodeActions(document, range, token);
    }
    
    return [];
  }
  
  // Public methods
  public async getSuggestions(uri: vscode.Uri): Promise<CodeSuggestion[]> {
    return this.suggestions.get(uri.toString()) || [];
  }
  
  public async applySuggestion(uri: vscode.Uri, suggestionId: string): Promise<boolean> {
    const suggestions = this.suggestions.get(uri.toString()) || [];
    const suggestion = suggestions.find(s => s.id === suggestionId);
    
    if (!suggestion) {
      return false;
    }
    
    // Apply suggestion as a workspace edit
    try {
      const edit = new vscode.WorkspaceEdit();
      
      switch (suggestion.type) {
        case SuggestionType.FIX:
          // For fix suggestions, we replace the range with the suggested text
          edit.replace(uri, suggestion.range, suggestion.text);
          break;
        case SuggestionType.REFACTORING:
          // For refactoring suggestions, the implementation would be more complex
          // For now, we just replace the range with the suggested text
          edit.replace(uri, suggestion.range, suggestion.text);
          break;
        case SuggestionType.COMPLETION:
          // For completion suggestions, we insert at the position
          edit.insert(uri, suggestion.range.start, suggestion.text);
          break;
        case SuggestionType.DOCUMENTATION:
          // For documentation suggestions, we insert at the position
          edit.insert(uri, suggestion.range.start, suggestion.text);
          break;
      }
      
      // Apply the edit
      await vscode.workspace.applyEdit(edit);
      
      // Remove the applied suggestion
      this.suggestions.set(
        uri.toString(),
        suggestions.filter(s => s.id !== suggestionId)
      );
      
      // Emit event
      this._onSuggestionsUpdated.fire({
        uri,
        suggestions: this.suggestions.get(uri.toString()) || []
      });
      
      return true;
    } catch (error) {
      console.error('Error applying suggestion:', error);
      return false;
    }
  }
  
  // Dispose of resources
  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    
    this._onSuggestionsUpdated.dispose();
  }

  /**
   * Find files related to the given file
   * This helps the AI navigate between connected files in the codebase
   */
  public async findRelatedFiles(filePath: string): Promise<string[]> {
    try {
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const fileContent = document.getText();
      const fileExtension = filePath.split('.').pop()?.toLowerCase();
      
      // Store related files
      const relatedFiles: Set<string> = new Set();
      
      // Different strategies based on file type
      if (['ts', 'tsx', 'js', 'jsx'].includes(fileExtension || '')) {
        // For TypeScript/JavaScript files, find imports
        await this.findJsImports(fileContent, filePath, relatedFiles);
      } else if (['py'].includes(fileExtension || '')) {
        // For Python files, find imports
        await this.findPythonImports(fileContent, filePath, relatedFiles);
      } else if (['java', 'kt', 'scala'].includes(fileExtension || '')) {
        // For JVM languages, find imports
        await this.findJvmImports(fileContent, filePath, relatedFiles);
      } else if (['c', 'cpp', 'h', 'hpp'].includes(fileExtension || '')) {
        // For C/C++ files, find includes
        await this.findCppIncludes(fileContent, filePath, relatedFiles);
      } else if (['go'].includes(fileExtension || '')) {
        // For Go files, find imports
        await this.findGoImports(fileContent, filePath, relatedFiles);
      } else if (['rs'].includes(fileExtension || '')) {
        // For Rust files, find use statements
        await this.findRustUses(fileContent, filePath, relatedFiles);
      }
      
      // Find references to this file throughout the workspace
      await this.findReferencesToFile(filePath, relatedFiles);
      
      // Find test files for this file and vice versa
      await this.findTestRelationships(filePath, relatedFiles);
      
      // Find sibling files in the same directory
      await this.findSiblingFiles(filePath, relatedFiles);
      
      // Convert set to array
      return Array.from(relatedFiles);
    } catch (error) {
      console.error(`Error finding related files for ${filePath}:`, error);
      return [];
    }
  }
  
  /**
   * Find TypeScript/JavaScript imports
   */
  private async findJsImports(fileContent: string, filePath: string, relatedFiles: Set<string>): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
    if (!workspaceFolder) {return;}
    
    const directoryPath = filePath.substring(0, filePath.lastIndexOf('/'));
    
    // Regular expression to find ES6 imports and requires
    const importRegex = /(?:import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(fileContent)) !== null) {
      const importPath = match[1];
      
      // Skip node_modules and built-in imports
      if (importPath.startsWith('@') || !importPath.includes('/') || importPath.startsWith('.')) {
        // Resolve relative import
        let fullPath = '';
        
        if (importPath.startsWith('.')) {
          fullPath = vscode.Uri.joinPath(vscode.Uri.file(directoryPath), importPath).fsPath;
        } else {
          // For non-relative imports, try to resolve against node_modules
          // This is a simplification; full resolution would be more complex
          fullPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceFolder), 'node_modules', importPath).fsPath;
        }
        
        // Add file extensions if needed
        const extensions = ['.ts', '.tsx', '.js', '.jsx'];
        
        // Check if the import exists
        let foundFile = false;
        for (const ext of extensions) {
          if (await this.fileExists(fullPath + ext)) {
            relatedFiles.add(fullPath + ext);
            foundFile = true;
            break;
          }
        }
        
        // Check for index files
        if (!foundFile) {
          for (const ext of extensions) {
            if (await this.fileExists(vscode.Uri.joinPath(vscode.Uri.file(fullPath), `index${ext}`).fsPath)) {
              relatedFiles.add(vscode.Uri.joinPath(vscode.Uri.file(fullPath), `index${ext}`).fsPath);
              break;
            }
          }
        }
      }
    }
  }
  
  /**
   * Find Python imports
   */
  private async findPythonImports(fileContent: string, filePath: string, relatedFiles: Set<string>): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
    if (!workspaceFolder) {return;}
    
    const directoryPath = filePath.substring(0, filePath.lastIndexOf('/'));
    
    // Regular expression to find Python imports
    const importRegex = /(?:from\s+(\S+)\s+import|import\s+([^,\s]+))/g;
    let match;
    
    while ((match = importRegex.exec(fileContent)) !== null) {
      const importPath = (match[1] || match[2]).replace(/\./g, '/');
      
      // Skip built-in modules
      if (!importPath.includes('/')) {continue;}
      
      // Try to resolve the import
      const possiblePaths = [
        vscode.Uri.joinPath(vscode.Uri.file(workspaceFolder), `${importPath}.py`).fsPath,
        vscode.Uri.joinPath(vscode.Uri.file(directoryPath), `${importPath}.py`).fsPath,
        vscode.Uri.joinPath(vscode.Uri.file(workspaceFolder), importPath, '__init__.py').fsPath
      ];
      
      for (const path of possiblePaths) {
        if (await this.fileExists(path)) {
          relatedFiles.add(path);
          break;
        }
      }
    }
  }
  
  /**
   * Find JVM (Java, Kotlin, Scala) imports
   */
  private async findJvmImports(fileContent: string, filePath: string, relatedFiles: Set<string>): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
    if (!workspaceFolder) {return;}
    
    // Regular expression to find JVM imports
    const importRegex = /import\s+([^;]+);/g;
    let match;
    
    while ((match = importRegex.exec(fileContent)) !== null) {
      const importPath = match[1].trim().replace(/\./g, '/');
      
      // Skip wildcard imports and static imports
      if (importPath.endsWith('*') || importPath.includes(' static ')) {continue;}
      
      // Try to find the file in the source directories
      const possibleDirs = ['src/main/java', 'src/main/kotlin', 'src/main/scala'];
      
      for (const dir of possibleDirs) {
        const extensions = ['.java', '.kt', '.scala'];
        
        for (const ext of extensions) {
          const fullPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceFolder), dir, `${importPath}${ext}`).fsPath;
          
          if (await this.fileExists(fullPath)) {
            relatedFiles.add(fullPath);
            break;
          }
        }
      }
    }
  }
  
  /**
   * Find C/C++ includes
   */
  private async findCppIncludes(fileContent: string, filePath: string, relatedFiles: Set<string>): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
    if (!workspaceFolder) {return;}
    
    const directoryPath = filePath.substring(0, filePath.lastIndexOf('/'));
    
    // Regular expression to find C/C++ includes
    const includeRegex = /#include\s+["<]([^">]+)[">]/g;
    let match;
    
    while ((match = includeRegex.exec(fileContent)) !== null) {
      const includePath = match[1];
      
      // Skip system includes
      if (match[0].includes('<')) {continue;}
      
      // Try to resolve the include
      const fullPath = vscode.Uri.joinPath(vscode.Uri.file(directoryPath), includePath).fsPath;
      
      if (await this.fileExists(fullPath)) {
        relatedFiles.add(fullPath);
      }
    }
  }
  
  /**
   * Find Go imports
   */
  private async findGoImports(fileContent: string, filePath: string, relatedFiles: Set<string>): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
    if (!workspaceFolder) {return;}
    
    // Regular expression to find Go imports
    const importRegex = /import\s+\(\s*([^)]+)\s*\)/gs;
    const singleImportRegex = /import\s+(?:\w+\s+)?["']([^"']+)["']/g;
    
    // Find block imports
    let blockMatch = importRegex.exec(fileContent);
    if (blockMatch) {
      const importsBlock = blockMatch[1];
      const lineImportRegex = /["']([^"']+)["']/g;
      let lineMatch;
      
      while ((lineMatch = lineImportRegex.exec(importsBlock)) !== null) {
        const importPath = lineMatch[1];
        await this.tryAddGoImport(importPath, workspaceFolder, relatedFiles);
      }
    }
    
    // Find single line imports
    let singleMatch;
    while ((singleMatch = singleImportRegex.exec(fileContent)) !== null) {
      const importPath = singleMatch[1];
      await this.tryAddGoImport(importPath, workspaceFolder, relatedFiles);
    }
  }
  
  /**
   * Try to add a Go import to related files
   */
  private async tryAddGoImport(importPath: string, workspaceFolder: string, relatedFiles: Set<string>): Promise<void> {
    // Skip standard library
    if (!importPath.includes('/')) {return;}
    
    // Check if this is an internal import (from the current workspace)
    const goModMatches = importPath.match(/^([^/]+\/[^/]+)/);
    if (!goModMatches) {return;}
    
    // Look for the file in the workspace
    const goPathDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceFolder), 'src', importPath).fsPath;
    
    // Check for .go files in the directory
    try {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(goPathDir, '*.go'),
        null,
        10
      );
      
      for (const file of files) {
        relatedFiles.add(file.fsPath);
      }
    } catch (error) {
      // Directory might not exist, which is fine
    }
  }
  
  /**
   * Find Rust use statements
   */
  private async findRustUses(fileContent: string, filePath: string, relatedFiles: Set<string>): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
    if (!workspaceFolder) {return;}
    
    // Regular expression to find Rust use statements
    const useRegex = /use\s+([^;]+);/g;
    let match;
    
    while ((match = useRegex.exec(fileContent)) !== null) {
      const usePath = match[1].trim();
      
      // Skip std, core, etc.
      if (usePath.startsWith('std::') || usePath.startsWith('core::')) {continue;}
      
      // Resolve crate-relative paths: use crate::foo::bar → src/foo/bar.rs or src/foo/bar/mod.rs
      const segments = usePath
        .replace(/^(crate|super|self)::/, '')
        .replace(/::\{[^}]+\}$/, '') // strip grouped imports like ::{A, B}
        .replace(/::\*$/, '')         // strip glob
        .split('::');

      if (segments.length === 0) { continue; }

      // Try common Rust module file patterns
      const candidatePaths = [
        path.join(workspaceFolder, 'src', ...segments) + '.rs',
        path.join(workspaceFolder, 'src', ...segments, 'mod.rs'),
      ];

      for (const candidate of candidatePaths) {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
          relatedFiles.add(candidate);
          break;
        } catch {
          // file doesn't exist, try next candidate
        }
      }
    }
  }
  
  /**
   * Find references to this file throughout the workspace
   */
  private async findReferencesToFile(filePath: string, relatedFiles: Set<string>): Promise<void> {
    try {
      // Extract the file name without extension
      const fileName = filePath.split('/').pop()?.split('.')[0];
      if (!fileName) {return;}
      
      // Search for references to the file name in the workspace
      const results = await vscode.workspace.findFiles(
        '**/*.{ts,tsx,js,jsx,py,java,kt,scala,c,cpp,h,hpp,go,rs}',
        '**/node_modules/**',
        100
      );
      
      for (const result of results) {
        // Skip the original file
        if (result.fsPath === filePath) {continue;}
        
        const document = await vscode.workspace.openTextDocument(result);
        const content = document.getText();
        
        // Check if the file name appears in the content
        // This is a simplified approach - more sophisticated reference detection would be better
        if (content.includes(fileName)) {
          relatedFiles.add(result.fsPath);
        }
      }
    } catch (error) {
      console.error('Error finding references:', error);
    }
  }
  
  /**
   * Find test files for this file and vice versa
   */
  private async findTestRelationships(filePath: string, relatedFiles: Set<string>): Promise<void> {
    const fileName = filePath.split('/').pop()?.split('.')[0];
    if (!fileName) {return;}
    
    const isTestFile = fileName.includes('test') || fileName.includes('spec');
    
    try {
      if (isTestFile) {
        // If this is a test file, find the implementation file
        const baseFileName = fileName
          .replace('test', '')
          .replace('spec', '')
          .replace('.', '')
          .replace('_', '')
          .replace('-', '');
          
        if (baseFileName) {
          const directory = filePath.substring(0, filePath.lastIndexOf('/'));
          
          const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(directory, `**/*${baseFileName}*`),
            '**/*test*',
            10
          );
          
          for (const file of files) {
            relatedFiles.add(file.fsPath);
          }
        }
      } else {
        // If this is an implementation file, find test files
        const directory = filePath.substring(0, filePath.lastIndexOf('/'));
        
        const testPatterns = [
          `**/${fileName}*test*`,
          `**/${fileName}*spec*`,
          `**/test*${fileName}*`,
          `**/spec*${fileName}*`
        ];
        
        for (const pattern of testPatterns) {
          const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(directory, pattern),
            null,
            5
          );
          
          for (const file of files) {
            relatedFiles.add(file.fsPath);
          }
        }
      }
    } catch (error) {
      console.error('Error finding test relationships:', error);
    }
  }
  
  /**
   * Find sibling files in the same directory
   */
  private async findSiblingFiles(filePath: string, relatedFiles: Set<string>): Promise<void> {
    try {
      const directory = filePath.substring(0, filePath.lastIndexOf('/'));
      
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(directory, '*'),
        null,
        20
      );
      
      for (const file of files) {
        // Skip the original file and already found related files
        if (file.fsPath !== filePath && !relatedFiles.has(file.fsPath)) {
          relatedFiles.add(file.fsPath);
        }
      }
    } catch (error) {
      console.error('Error finding sibling files:', error);
    }
  }
  
  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Analyze project structure to understand the codebase organization
   */
  public async analyzeProjectStructure(): Promise<{
    mainModules: string[];
    dependencies: Record<string, string[]>;
    entryPoints: string[];
  }> {
    const result = {
      mainModules: [] as string[],
      dependencies: {} as Record<string, string[]>,
      entryPoints: [] as string[]
    };
    
    try {
      // Get all workspace folders
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {return result;}
      
      // Look for common entry points
      const entryPatterns = [
        '**/main.{ts,js,py,java,go,rs}',
        '**/index.{ts,js}',
        '**/app.{ts,js,py}',
        '**/server.{ts,js,py}',
        '**/cli.{ts,js,py}'
      ];
      
      for (const pattern of entryPatterns) {
        const entryFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 10);
        for (const file of entryFiles) {
          result.entryPoints.push(file.fsPath);
        }
      }
      
      // Find main modules by looking at directory structure
      for (const folder of workspaceFolders) {
        const mainDirs = [
          'src',
          'app',
          'lib',
          'core',
          'modules',
          'services'
        ];
        
        for (const dir of mainDirs) {
          const dirPath = vscode.Uri.joinPath(folder.uri, dir).fsPath;
          if (await this.fileExists(dirPath)) {
            // List subdirectories in the main directory
            const files = await vscode.workspace.findFiles(
              new vscode.RelativePattern(dirPath, '**/'),
              '**/node_modules/**',
              20
            );
            
            for (const file of files) {
              // Add directory as a main module
              result.mainModules.push(file.fsPath);
            }
          }
        }
      }
      
      // Analyze dependencies between modules
      for (const module of result.mainModules) {
        result.dependencies[module] = [];
        
        // Find all source files in the module
        const sourceFiles = await vscode.workspace.findFiles(
          new vscode.RelativePattern(module, '**/*.{ts,js,py,java,kt,go,rs}'),
          null,
          50
        );
        
        for (const file of sourceFiles) {
          // Find related files
          const relatedFiles = await this.findRelatedFiles(file.fsPath);
          
          // Check which other modules these files belong to
          for (const related of relatedFiles) {
            for (const otherModule of result.mainModules) {
              if (related.startsWith(otherModule) && module !== otherModule) {
                if (!result.dependencies[module].includes(otherModule)) {
                  result.dependencies[module].push(otherModule);
                }
              }
            }
          }
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error analyzing project structure:', error);
      return result;
    }
  }
} 