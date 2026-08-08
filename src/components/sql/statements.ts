/**
 * Where each statement in a SQL document starts and ends.
 *
 * Lives apart from the editor component so it can be tested on its own and so
 * the editor file keeps exporting nothing but a component.
 */

/**
 * Split on semicolons that are not inside a string, an identifier or a comment.
 * The backend re-splits authoritatively; this only has to be good enough to
 * pick the statement under the cursor.
 */
export function statementRanges(doc: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let start = 0;
  let index = 0;

  while (index < doc.length) {
    const char = doc[index]!;

    if (char === '-' && doc[index + 1] === '-') {
      const newline = doc.indexOf('\n', index);
      index = newline === -1 ? doc.length : newline + 1;
      continue;
    }
    if (char === '/' && doc[index + 1] === '*') {
      const end = doc.indexOf('*/', index + 2);
      index = end === -1 ? doc.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      index += 1;
      while (index < doc.length) {
        if (doc[index] === char) {
          if (doc[index + 1] === char) index += 2;
          else break;
        } else {
          index += 1;
        }
      }
      index += 1;
      continue;
    }
    if (char === '$') {
      // Dollar quoting: $tag$ … $tag$.
      const match = /^\$[A-Za-z_]*\$/.exec(doc.slice(index));
      if (match) {
        const end = doc.indexOf(match[0], index + match[0].length);
        index = end === -1 ? doc.length : end + match[0].length;
        continue;
      }
    }
    if (char === ';') {
      ranges.push({ from: start, to: index + 1 });
      start = index + 1;
    }
    index += 1;
  }

  if (start < doc.length) ranges.push({ from: start, to: doc.length });
  return ranges;
}
