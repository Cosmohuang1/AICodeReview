import parseDiffLib from 'parse-diff';

export interface ParsedHunk {
  oldStart: number;
  newStart: number;
  newLines: string[];
  diffPosition: number; // 从文件 diff 开始的行偏移（GitHub position）
  rawHunk: string;
}

export interface ParsedFile {
  filePath: string;
  language: string;
  hunks: ParsedHunk[];
  isNew: boolean;
  isDeleted: boolean;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  php: 'php',
  rb: 'ruby',
  kt: 'kotlin',
  swift: 'swift',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

export function parseDiff(rawDiff: string): ParsedFile[] {
  if (!rawDiff || !rawDiff.trim()) return [];
  const files = parseDiffLib(rawDiff);

  return files
    .filter(f => Boolean((f.to && f.to !== '/dev/null') || (f.from && f.from !== '/dev/null')))
    .map(f => {
      const isDeleted = Boolean(f.deleted || !f.to || f.to === '/dev/null');
      const filePath = isDeleted ? (f.from ?? 'unknown') : (f.to ?? f.from ?? 'unknown');
      let position = 0; // diff position counter

      const hunks: ParsedHunk[] = f.chunks.map(chunk => {
        position++; // hunk header line counts as position 1
        const newLines: string[] = [];
        const rawLines: string[] = [];

        for (const change of chunk.changes) {
          position++;
          const line = change.content;
          const hasPrefix = line.startsWith('+') || line.startsWith('-') || line.startsWith(' ');
          const prefix = change.type === 'add' ? '+' : change.type === 'del' ? '-' : ' ';
          const rawLine = hasPrefix ? line : `${prefix}${line}`;
          const cleanLine = hasPrefix ? line.slice(1) : line;

          rawLines.push(rawLine);
          if (change.type === 'add' || change.type === 'normal') {
            newLines.push(cleanLine);
          }
        }

        return {
          oldStart: chunk.oldStart,
          newStart: chunk.newStart,
          newLines,
          diffPosition: position - chunk.changes.length, // position of first change
          rawHunk: rawLines.join('\n'),
        };
      });

      return {
        filePath,
        language: detectLanguage(filePath),
        hunks,
        isNew: Boolean(f.new),
        isDeleted,
      };
    });
}
