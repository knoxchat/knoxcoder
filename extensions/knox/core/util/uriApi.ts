type UriLike = string | { toString(): string };

function toUriString(uri: UriLike): string {
  return typeof uri === "string" ? uri : uri.toString();
}

export function parse(uri: string): { scheme?: string; path?: string } {
  try {
    const url = new URL(uri);
    const scheme = url.protocol.replace(/:$/, "");
    return {
      scheme: scheme || undefined,
      path: url.pathname || undefined,
    };
  } catch {
    return {};
  }
}

export function resolve(baseUri: string, path: string): string {
  return new URL(path, baseUri).href;
}

export function normalize(uri: string): string {
  return new URL(uri).href;
}

export function equal(uriA: UriLike, uriB: UriLike): boolean {
  const a = toUriString(uriA);
  const b = toUriString(uriB);
  if (a === b) {
    return true;
  }
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}
