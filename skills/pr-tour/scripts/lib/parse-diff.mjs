export function parseUnifiedDiff(diffText) {
  const chunks = diffText.split(/(?=^diff --git )/m).filter((c) => c.trim().length > 0);
  return chunks.map(parseFileChunk);
}

function parseFileChunk(chunk) {
  const lines = chunk.split('\n');
  const hunkStart = lines.findIndex((line) => line.startsWith('@@ '));
  const headerLines = hunkStart === -1 ? lines : lines.slice(0, hunkStart);
  const header = headerLines.join('\n').trimEnd();

  const gitLine = headerLines.find((line) => line.startsWith('diff --git '));
  const gitMatch = gitLine ? gitLine.match(/^diff --git a\/(.+) b\/(.+)$/) : null;

  const minusLine = headerLines.find((line) => line.startsWith('--- '));
  const plusLine = headerLines.find((line) => line.startsWith('+++ '));

  const isAdded =
    headerLines.some((line) => line.startsWith('new file mode')) ||
    minusLine === '--- /dev/null';
  const isDeleted =
    headerLines.some((line) => line.startsWith('deleted file mode')) ||
    plusLine === '+++ /dev/null';
  const isRenamed = headerLines.some((line) => line.startsWith('rename from'));

  const status = isDeleted ? 'deleted' : isAdded ? 'added' : isRenamed ? 'renamed' : 'modified';

  const oldPath = minusLine && minusLine !== '--- /dev/null'
    ? minusLine.replace(/^--- a\//, '')
    : gitMatch?.[1] ?? null;
  const path = plusLine && plusLine !== '+++ /dev/null'
    ? plusLine.replace(/^\+\+\+ b\//, '')
    : oldPath;

  const hunks = [];
  if (hunkStart !== -1) {
    let current = [];
    for (const line of lines.slice(hunkStart)) {
      if (line.startsWith('@@ ') && current.length > 0) {
        hunks.push(current.join('\n').trimEnd());
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) hunks.push(current.join('\n').trimEnd());
  }

  return { path, oldPath, status, header, hunks };
}
