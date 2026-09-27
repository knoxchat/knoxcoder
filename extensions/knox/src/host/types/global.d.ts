// Global type declarations to fix compatibility issues

// Fix monaco-editor missing module declarations
declare module 'monaco-editor' {
  // Basic monaco editor types - minimal declarations to satisfy imports
  export interface ITextModel {
    getValue(): string;
    setValue(value: string): void;
  }
  
  export interface IEditor {
    getModel(): ITextModel | null;
    setModel(model: ITextModel | null): void;
  }
  
  export interface IRange {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }
  
  export interface IPosition {
    lineNumber: number;
    column: number;
  }
  
  // Re-export common types that might be expected
  export const editor: any;
  export const languages: any;
  export const Range: any;
  export const Position: any;
}

// Fix iterator compatibility issues with TypeScript 5.6+ disposable iterators
declare global {
  // Extend IterableIterator to include Symbol.dispose for compatibility
  interface IterableIterator<T> {
    [Symbol.dispose]?(): void;
  }
}

export {};
