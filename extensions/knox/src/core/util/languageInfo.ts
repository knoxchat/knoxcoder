import { getUriFileExtension } from "./uri";

export interface LanguageInfo {
  name: string;
  singleLineComment?: string;
}

export const Typescript: LanguageInfo = {
  name: "TypeScript",
  singleLineComment: "//",
};

export const Python: LanguageInfo = {
  name: "Python",
  singleLineComment: "#",
};

export const Java: LanguageInfo = {
  name: "Java",
  singleLineComment: "//",
};

export const Cpp: LanguageInfo = {
  name: "C++",
  singleLineComment: "//",
};

export const CSharp: LanguageInfo = {
  name: "C#",
  singleLineComment: "//",
};

export const C: LanguageInfo = {
  name: "C",
  singleLineComment: "//",
};

export const Scala: LanguageInfo = {
  name: "Scala",
  singleLineComment: "//",
};

export const Go: LanguageInfo = {
  name: "Go",
  singleLineComment: "//",
};

export const Rust: LanguageInfo = {
  name: "Rust",
  singleLineComment: "//",
};

export const Haskell: LanguageInfo = {
  name: "Haskell",
  singleLineComment: "--",
};

export const PHP: LanguageInfo = {
  name: "PHP",
  singleLineComment: "//",
};

export const RubyOnRails: LanguageInfo = {
  name: "Ruby on Rails",
  singleLineComment: "#",
};

export const Swift: LanguageInfo = {
  name: "Swift",
  singleLineComment: "//",
};

export const Kotlin: LanguageInfo = {
  name: "Kotlin",
  singleLineComment: "//",
};

export const Ruby: LanguageInfo = {
  name: "Ruby",
  singleLineComment: "#",
};

export const Clojure: LanguageInfo = {
  name: "Clojure",
  singleLineComment: ";",
};

export const Julia: LanguageInfo = {
  name: "Julia",
  singleLineComment: "#",
};

export const FSharp: LanguageInfo = {
  name: "F#",
  singleLineComment: "//",
};

export const R: LanguageInfo = {
  name: "R",
  singleLineComment: "#",
};

export const Dart: LanguageInfo = {
  name: "Dart",
  singleLineComment: "//",
};

export const Solidity: LanguageInfo = {
  name: "Solidity",
  singleLineComment: "//",
};

export const Lua: LanguageInfo = {
  name: "Lua",
  singleLineComment: "--",
};

export const YAML: LanguageInfo = {
  name: "YAML",
  singleLineComment: "#",
};

export const Json: LanguageInfo = {
  name: "JSON",
  singleLineComment: "//",
};

export const Markdown: LanguageInfo = {
  name: "Markdown",
  singleLineComment: "",
};

export const LANGUAGES: { [extension: string]: LanguageInfo } = {
  ts: Typescript,
  js: Typescript,
  tsx: Typescript,
  json: Json,
  jsx: Typescript,
  ipynb: Python,
  py: Python,
  pyi: Python,
  java: Java,
  cpp: Cpp,
  cxx: Cpp,
  h: Cpp,
  hpp: Cpp,
  cs: CSharp,
  c: C,
  scala: Scala,
  sc: Scala,
  go: Go,
  rs: Rust,
  hs: Haskell,
  php: PHP,
  rb: Ruby,
  rails: RubyOnRails,
  swift: Swift,
  kt: Kotlin,
  clj: Clojure,
  cljs: Clojure,
  cljc: Clojure,
  jl: Julia,
  fs: FSharp,
  fsi: FSharp,
  fsx: FSharp,
  fsscript: FSharp,
  r: R,
  R: R,
  dart: Dart,
  sol: Solidity,
  yaml: YAML,
  yml: YAML,
  md: Markdown,
  lua: Lua,
  luau: Lua,
};

export function languageForFilepath(fileUri: string): LanguageInfo {
  const extension = getUriFileExtension(fileUri);
  return LANGUAGES[extension] || Typescript;
}
