export interface MacroTextPart {
  kind: 'text' | 'bold' | 'italic' | 'code';
  text: string;
}

/** Small inline text grammar shared by the UI and Discord; never interprets HTML or links. */
export function macroTextParts(text: string): MacroTextPart[] {
  const parts: MacroTextPart[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > position)
      parts.push({ kind: 'text', text: text.slice(position, match.index) });
    parts.push({
      kind: match[1] !== undefined ? 'bold' : match[2] !== undefined ? 'italic' : 'code',
      text: match[1] ?? match[2] ?? match[3],
    });
    position = match.index + match[0].length;
  }
  if (position < text.length) parts.push({ kind: 'text', text: text.slice(position) });
  return parts;
}

export function discordTableEntry(text: string): string {
  return macroTextParts(text)
    .map((part) => {
      const safe = part.text.replace(/[\\*_`~|<>\[\]()#]/g, '\\$&').replace(/@/g, '@\u200b');
      const marker = part.kind === 'bold' ? '**' : part.kind === 'italic' ? '*' : '';
      // Code spans display their contents literally; neutralize mentions in them too.
      return part.kind === 'code'
        ? `\`${part.text.replace(/@/g, '@\u200b')}\``
        : `${marker}${safe}${marker}`;
    })
    .join('');
}
