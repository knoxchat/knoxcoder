/**
 * File Filter Service - Handles .gitignore and .aicontextignore filtering
 * Ensures only relevant files are included in AI context analysis
 */

// Browser-compatible path utilities
const pathUtils = {
  join: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
  relative: (from: string, to: string) => {
    const fromParts = from.split('/');
    const toParts = to.split('/');
    let i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
      i++;
    }
    const upCount = fromParts.length - i;
    const downPath = toParts.slice(i).join('/');
    return '../'.repeat(upCount) + downPath;
  },
  resolve: (...parts: string[]) => pathUtils.join('/', ...parts),
  extname: (filepath: string) => {
    const lastDot = filepath.lastIndexOf('.');
    return lastDot >= 0 ? filepath.substring(lastDot) : '';
  },
  basename: (filepath: string) => {
    return filepath.split('/').pop() || '';
  }
};

export interface FilterRule {
  pattern: string;
  isNegation: boolean;
  isDirectory: boolean;
  source: 'gitignore' | 'knoxignore' | 'builtin';
}

export class FileFilterService {
  private static instance: FileFilterService;
  private gitignoreRules: FilterRule[] = [];
  private knoxIgnoreRules: FilterRule[] = [];
  private builtinRules: FilterRule[] = [];

  constructor() {
    this.initializeBuiltinRules();
  }

  static getInstance(): FileFilterService {
    if (!FileFilterService.instance) {
      FileFilterService.instance = new FileFilterService();
    }
    return FileFilterService.instance;
  }

  /**
   * Initialize built-in ignore rules for AI context
   */
  private initializeBuiltinRules(): void {
    this.builtinRules = [
      // Build directories (match anywhere in path)
      { pattern: '**/node_modules/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/target/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/build/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/dist/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/out/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/bin/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/obj/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/.next/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/.nuxt/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/coverage/**', isNegation: false, isDirectory: true, source: 'builtin' },
      
      // Cache and temporary directories
      { pattern: '**/.cache/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/tmp/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/temp/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/__pycache__/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/.pytest_cache/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/.tox/**', isNegation: false, isDirectory: true, source: 'builtin' },
      
      // Version control
      { pattern: '**/.git/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/.svn/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/.hg/**', isNegation: false, isDirectory: true, source: 'builtin' },
      
      // IDE and editor files
      { pattern: '**/.vscode/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '**/.idea/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '*.swp', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.swo', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*~', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '.DS_Store', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: 'Thumbs.db', isNegation: false, isDirectory: false, source: 'builtin' },
      
      // Log files
      { pattern: '*.log', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '**/logs/**', isNegation: false, isDirectory: true, source: 'builtin' },
      
      // Package manager files (keep package.json but ignore lock files)
      { pattern: 'package-lock.json', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: 'yarn.lock', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: 'pnpm-lock.yaml', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: 'Cargo.lock', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: 'poetry.lock', isNegation: false, isDirectory: false, source: 'builtin' },
      
      // Binary and compiled files
      { pattern: '*.exe', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.dll', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.so', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.dylib', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.o', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.a', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.class', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.pyc', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.pyo', isNegation: false, isDirectory: false, source: 'builtin' },
      
      // Large media files (usually not relevant for code context)
      { pattern: '*.jpg', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.jpeg', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.png', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.gif', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.svg', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.ico', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.mp4', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.mp3', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.wav', isNegation: false, isDirectory: false, source: 'builtin' },
      { pattern: '*.pdf', isNegation: false, isDirectory: false, source: 'builtin' },
      
      // Documentation that's usually auto-generated
      { pattern: 'docs/build/**', isNegation: false, isDirectory: true, source: 'builtin' },
      { pattern: '_site/**', isNegation: false, isDirectory: true, source: 'builtin' },
    ];
  }

  /**
   * Load and parse .gitignore file (browser-compatible)
   */
  async loadGitignoreRules(workspaceRoot: string): Promise<void> {
    try {
      console.log('[BROWSER] Browser context - using built-in rules only');
      // In browser context, we rely on built-in rules
      // The Rust backend should handle .gitignore parsing
      return;
    } catch (error) {
      console.warn('Could not load .gitignore:', error);
    }
  }

  /**
   * Load and parse .knoxignore file (browser-compatible)
   */
  async loadKnoxIgnoreRules(workspaceRoot: string): Promise<void> {
    try {
      console.log('[BROWSER] Browser context - using built-in rules only');
      // In browser context, we rely on built-in rules
      // The Rust backend should handle .knoxignore parsing
      return;
    } catch (error) {
      console.warn('Could not load .knoxignore:', error);
    }
  }

  /**
   * Parse ignore file content into rules
   */
  private parseIgnoreFile(content: string, source: 'gitignore' | 'knoxignore'): FilterRule[] {
    const rules: FilterRule[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const isNegation = trimmed.startsWith('!');
      const pattern = isNegation ? trimmed.substring(1) : trimmed;
      const isDirectory = pattern.endsWith('/');
      
      rules.push({
        pattern: isDirectory ? pattern.slice(0, -1) + '/**' : pattern,
        isNegation,
        isDirectory,
        source
      });
    }

    return rules;
  }

  /**
   * Check if a file should be included in AI context analysis
   */
  shouldIncludeFile(filePath: string, workspaceRoot: string): boolean {
    // Browser-compatible path handling
    const relativePath = filePath.startsWith(workspaceRoot) 
      ? filePath.substring(workspaceRoot.length + 1)
      : filePath;
    
    // Always exclude files outside workspace
    if (relativePath.startsWith('..')) {
      return false;
    }

    // Check against all rule sets (order matters: builtin -> gitignore -> knoxignore)
    const allRules = [
      ...this.builtinRules,
      ...this.gitignoreRules,
      ...this.knoxIgnoreRules
    ];

    let shouldInclude = true;

    for (const rule of allRules) {
      if (this.matchesPattern(relativePath, rule.pattern)) {
        if (rule.isNegation) {
          shouldInclude = true; // Negation rules override previous excludes
        } else {
          shouldInclude = false; // Exclude this file
        }
      }
    }

    return shouldInclude;
  }

  /**
   * Filter a list of files based on ignore rules
   */
  async filterFiles(files: string[], workspaceRoot: string): Promise<string[]> {
    // Load ignore rules if not already loaded
    if (this.gitignoreRules.length === 0) {
      await this.loadGitignoreRules(workspaceRoot);
    }
    if (this.knoxIgnoreRules.length === 0) {
      await this.loadKnoxIgnoreRules(workspaceRoot);
    }

    const filtered = files.filter(file => this.shouldIncludeFile(file, workspaceRoot));
    
    console.log(`[FILTER] File filtering results:`);
    console.log(`  Total files: ${files.length}`);
    console.log(`  After filtering: ${filtered.length}`);
    console.log(`  Excluded: ${files.length - filtered.length}`);

    return filtered;
  }

  /**
   * Get files prioritized for AI context analysis
   */
  prioritizeFiles(files: string[]): string[] {
    const prioritized = files.sort((a, b) => {
      const scoreA = this.calculateFileRelevanceScore(a);
      const scoreB = this.calculateFileRelevanceScore(b);
      return scoreB - scoreA; // Higher score first
    });

    // Limit to reasonable number for performance
    return prioritized.slice(0, 100);
  }

  /**
   * Calculate relevance score for AI context (higher = more relevant)
   */
  private calculateFileRelevanceScore(filePath: string): number {
    let score = 0;

    // File extension scoring using browser-compatible method
    const ext = pathUtils.extname(filePath).toLowerCase();
    const extensionScores: { [key: string]: number } = {
      '.ts': 10, '.tsx': 10,
      '.js': 8, '.jsx': 8,
      '.py': 7,
      '.java': 6,
      '.rs': 9,
      '.go': 6,
      '.cpp': 5, '.c': 5,
      '.cs': 5,
      '.vue': 8,
      '.svelte': 8,
      '.md': 3, // Documentation is somewhat relevant
      '.json': 2, // Config files have some relevance
      '.yaml': 2, '.yml': 2,
      '.toml': 2,
      '.xml': 1
    };
    score += extensionScores[ext] || 0;

    // Directory-based scoring
    const pathLower = filePath.toLowerCase();
    
    // High priority directories
    if (pathLower.includes('src/') || pathLower.includes('lib/')) {score += 8;}
    if (pathLower.includes('core/')) {score += 7;}
    if (pathLower.includes('components/')) {score += 6;}
    if (pathLower.includes('services/')) {score += 6;}
    if (pathLower.includes('utils/') || pathLower.includes('helpers/')) {score += 5;}
    if (pathLower.includes('types/') || pathLower.includes('interfaces/')) {score += 7;}
    if (pathLower.includes('models/') || pathLower.includes('entities/')) {score += 6;}
    if (pathLower.includes('controllers/') || pathLower.includes('routes/')) {score += 6;}

    // Medium priority
    if (pathLower.includes('config/')) {score += 3;}
    if (pathLower.includes('assets/')) {score += 1;}
    if (pathLower.includes('public/')) {score += 1;}

    // Lower priority for tests (still relevant but not primary)
    if (pathLower.includes('test/') || pathLower.includes('spec/') || pathLower.includes('__tests__/')) {
      score += 2;
    }

    // Boost for root-level important files
    const fileName = pathUtils.basename(filePath).toLowerCase();
    if (['package.json', 'tsconfig.json', 'cargo.toml', 'setup.py', 'main.py', 'main.ts', 'index.ts', 'app.ts', 'server.ts'].includes(fileName)) {
      score += 5;
    }

    // Penalize deeply nested files (usually less important)
    const depth = filePath.split('/').length; // Use forward slash for cross-platform compatibility
    if (depth > 6) {score -= 2;}
    if (depth > 8) {score -= 3;}

    return Math.max(score, 0);
  }

  /**
   * Check if pattern matches file path (simplified glob matching)
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    let regexPattern = pattern
      .replace(/\*\*/g, '.*') // ** matches any number of directories
      .replace(/\*/g, '[^/]*') // * matches anything except path separator
      .replace(/\?/g, '.') // ? matches any single character
      .replace(/\./g, '\\.'); // Escape dots

    // Add anchors
    regexPattern = '^' + regexPattern + '$';

    try {
      const regex = new RegExp(regexPattern);
      return regex.test(filePath);
    } catch (error) {
      console.warn(`Invalid pattern: ${pattern}`, error);
      return false;
    }
  }

  /**
   * Check if file exists (browser-compatible - always returns false)
   */
  private async fileExists(filePath: string): Promise<boolean> {
    // In browser context, we can't directly check file existence
    // The Rust backend handles file system operations
    return false;
  }

  /**
   * Check if .knoxignore exists (browser-compatible)
   */
  async checkKnoxIgnoreFile(workspaceRoot: string): Promise<void> {
    console.log('[BROWSER] Browser context - .knoxignore checking handled by Rust backend');
    console.log('[TIP] File filtering is managed by the Rust checkpoint system.');
  }

  /**
   * Get statistics about filtering
   */
  getFilteringStats(): {
    builtinRules: number;
    gitignoreRules: number;
    knoxIgnoreRules: number;
    totalRules: number;
  } {
    return {
      builtinRules: this.builtinRules.length,
      gitignoreRules: this.gitignoreRules.length,
      knoxIgnoreRules: this.knoxIgnoreRules.length,
      totalRules: this.builtinRules.length + this.gitignoreRules.length + this.knoxIgnoreRules.length
    };
  }
}

export default FileFilterService;
