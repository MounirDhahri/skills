export function computeLineStats(diffText) {
  let added = 0;
  let deleted = 0;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }

  return { added, deleted };
}
