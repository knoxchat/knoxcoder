import type { Node } from "web-tree-sitter";

export function findInAst(
  node: Node,
  criterion: (node: Node) => boolean,
  shouldRecurse: (node: Node) => boolean = () => true,
): Node | null {
  const stack = [node];
  while (stack.length > 0) {
    let node = stack.pop()!;
    if (criterion(node)) {
      return node;
    }

    if (shouldRecurse(node)) {
      const validChildren = node.children.filter((child): child is Node => child !== null);
      stack.push(...validChildren);
    }
  }
  return null;
}
