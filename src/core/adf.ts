/**
 * Minimal Atlassian Document Format (ADF) builders.
 *
 * Jira REST v3 comments and descriptions are ADF JSON. These helpers are
 * intentionally tiny and typed structurally — no external ADF SDK.
 */

export type AdfMark = { type: 'strong' | 'em' | 'code' | 'link'; attrs?: Record<string, string> };
export type AdfInlineNode = { type: 'text'; text: string; marks?: AdfMark[] };
export type AdfBlockNode =
  | { type: 'paragraph'; content: AdfInlineNode[] }
  | { type: 'heading'; attrs: { level: 2 | 3 }; content: AdfInlineNode[] }
  | { type: 'bulletList'; content: Array<{ type: 'listItem'; content: AdfBlockNode[] }> };
export type AdfDoc = { type: 'doc'; version: 1; content: AdfBlockNode[] };

export function adfDoc(content: AdfBlockNode[]): AdfDoc {
  return { type: 'doc', version: 1, content };
}

export function paragraph(...content: AdfInlineNode[]): AdfBlockNode {
  return { type: 'paragraph', content: content.length > 0 ? content : [{ type: 'text', text: '' }] };
}

export function heading(level: 2 | 3, text: string): AdfBlockNode {
  return { type: 'heading', attrs: { level }, content: [text_(text)] };
}

export function bulletList(items: AdfInlineNode[][]): AdfBlockNode {
  return {
    type: 'bulletList',
    content: items.map((content) => ({ type: 'listItem', content: [paragraph(...content)] })),
  };
}

export function text_(text: string, marks?: AdfMark[]): AdfInlineNode {
  return { type: 'text', text, ...(marks ? { marks } : {}) };
}

export function strong(text: string): AdfInlineNode {
  return text_(text, [{ type: 'strong' }]);
}

export function em(text: string): AdfInlineNode {
  return text_(text, [{ type: 'em' }]);
}

export function code(text: string): AdfInlineNode {
  return text_(text, [{ type: 'code' }]);
}

export function link(text: string, href: string): AdfInlineNode {
  return text_(text, [{ type: 'link', attrs: { href } }]);
}

/**
 * Flatten an ADF doc (e.g. a Jira issue description) to plain text for the
 * similarity engine. Unknown node types contribute their text descendants;
 * blocks are separated by newlines.
 */
export function adfToPlainText(node: unknown): string {
  if (typeof node === 'string') return node.trim(); // defensive: plain-string descriptions
  const parts: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const obj = n as Record<string, unknown>;
    if (obj.type === 'text' && typeof obj.text === 'string') {
      parts.push(obj.text);
      return;
    }
    if (obj.type === 'hardBreak' || obj.type === 'paragraph' || obj.type === 'heading') {
      parts.push('\n');
    }
    if (Array.isArray(obj.content)) obj.content.forEach(walk);
  };
  walk(node);
  return parts.join(' ').replace(/[ \t]+/g, ' ').replace(/\n /g, '\n').trim();
}
