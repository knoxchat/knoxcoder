declare module "glob" {
  interface IOptions {
    cwd?: string;
    root?: string;
    dot?: boolean;
    nomount?: boolean;
    mark?: boolean;
    nosort?: boolean;
    stat?: boolean;
    silent?: boolean;
    strict?: boolean;
    cache?: { [path: string]: boolean | string | string[] };
    statCache?: { [path: string]: any };
    symlinks?: { [path: string]: boolean };
    realpathCache?: { [path: string]: string };
    [key: string]: any;
  }

  export function sync(pattern: string, options?: IOptions): string[];
}

