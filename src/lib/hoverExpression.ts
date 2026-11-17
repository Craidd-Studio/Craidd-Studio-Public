// Which text a debugger hover evaluates. Kept free of imports so it can be unit tested.

/** The identifier under the cursor with its member-access chain (`a.b.c`, `a->b`, `a::b`). */
export function expressionAt(line: string, column: number): { expression: string; start: number; end: number } | null {
  const index = column - 1;
  const isWord = (ch: string | undefined) => !!ch && /[A-Za-z0-9_$]/.test(ch);
  if (!isWord(line[index])) return null;
  let end = index;
  while (isWord(line[end + 1])) end += 1;
  let start = index;
  for (;;) {
    while (isWord(line[start - 1])) start -= 1;
    const before = line.slice(0, start);
    const separator = before.endsWith("->") || before.endsWith("::") ? 2 : before.endsWith(".") ? 1 : 0;
    if (!separator || !isWord(line[start - separator - 1])) break;
    start -= separator + 1;
  }
  const expression = line.slice(start, end + 1);
  if (/^\d/.test(expression)) return null;
  return { expression, start: start + 1, end: end + 2 };
}

