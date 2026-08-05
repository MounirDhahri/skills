export function buildSnapshotDiffText(snapshot) {
  const order = [];
  const byPath = new Map();

  for (const hunk of snapshot.hunks) {
    if (!byPath.has(hunk.path)) {
      byPath.set(hunk.path, { header: hunk.diffHeader, texts: [] });
      order.push(hunk.path);
    }
    byPath.get(hunk.path).texts.push(hunk.diffText);
  }

  return order
    .map((path) => {
      const { header, texts } = byPath.get(path);
      return [header, ...texts].join('\n');
    })
    .join('\n');
}
