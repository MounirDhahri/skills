export function groupHunksByFile(hunks) {
  const order = [];
  const byPath = new Map();

  for (const hunk of hunks) {
    if (!byPath.has(hunk.path)) {
      byPath.set(hunk.path, {
        path: hunk.path,
        status: hunk.status,
        header: hunk.diffHeader,
        texts: [],
      });
      order.push(hunk.path);
    }
    byPath.get(hunk.path).texts.push(hunk.diffText);
  }

  return order.map((path) => {
    const entry = byPath.get(path);
    return {
      path: entry.path,
      status: entry.status,
      diffText: [entry.header, ...entry.texts].join('\n'),
    };
  });
}
