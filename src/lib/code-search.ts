// Code search — backs the Ask-the-Cockpit "where is X defined" tool
// (Tier 4d). Operates on the build-time-generated index at
// src/lib/code-index.json (343 files, ~2 MiB). Lazy-imported on first
// use so cold-starts that don't need code search stay fast.
//
// Newsletter files are deliberately INCLUDED in the index — gy-command
// has its own newsletter operator surface code that George legitimately
// needs to navigate. The "don't modify newsletter" rule applies to
// behaviour changes, not to read-only navigation.

interface CodeIndexEntry {
  path: string;
  lines: number;
  bytes: number;
  content: string;
  truncated: boolean;
}

interface CodeIndex {
  generated_at: string;
  file_count: number;
  total_bytes: number;
  max_chars_per_file: number;
  files: CodeIndexEntry[];
}

let cachedIndex: CodeIndex | null = null;
let loadPromise: Promise<CodeIndex> | null = null;

async function loadIndex(): Promise<CodeIndex> {
  if (cachedIndex) return cachedIndex;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    // Dynamic import so this 2 MiB blob is NOT loaded on every cold
    // start — only when a code-search question hits the endpoint.
    const mod = await import("./code-index.json");
    const data = (mod as any).default ?? mod;
    cachedIndex = data as CodeIndex;
    return cachedIndex;
  })();
  return loadPromise;
}

export interface CodeSearchHit {
  path: string;
  lines: number;
  matches: { line_no: number; line: string }[];   // up to 4 matches per file
  path_score: number;                              // 0-100, weighted higher than content
  content_score: number;                           // raw match count
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Search the code index. Splits the query into terms, scores each file
 * by (path-name match * weight) + (content match count). Returns the
 * top N files with up to 4 matching lines each.
 */
export async function searchCode(
  query: string,
  opts?: { limit?: number; pathBoost?: number },
): Promise<CodeSearchHit[]> {
  const limit = opts?.limit ?? 8;
  const pathBoost = opts?.pathBoost ?? 30;
  const terms = query
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length < 60)
    .slice(0, 6);
  if (terms.length === 0) return [];

  const idx = await loadIndex();
  const hits: CodeSearchHit[] = [];

  for (const f of idx.files) {
    const lowerPath = f.path.toLowerCase();
    const lowerContent = f.content.toLowerCase();

    let pathScore = 0;
    for (const t of terms) {
      if (lowerPath.includes(t)) pathScore += pathBoost;
    }

    let contentScore = 0;
    const lineMatches: { line_no: number; line: string }[] = [];
    if (lowerContent.includes(terms[0])) {
      // Cheap pre-filter: at least the first term must appear in content.
      const lines = f.content.split("\n");
      const seen = new Set<number>();
      for (let i = 0; i < lines.length && lineMatches.length < 4; i++) {
        const lower = lines[i].toLowerCase();
        for (const t of terms) {
          if (lower.includes(t) && !seen.has(i)) {
            seen.add(i);
            // Cap line at 240 chars to keep payloads small
            const trimmed = lines[i].length > 240
              ? lines[i].slice(0, 240) + "…"
              : lines[i];
            lineMatches.push({ line_no: i + 1, line: trimmed });
            contentScore++;
            break;
          }
        }
      }
      // Total content score isn't capped at 4 — count all occurrences for ranking
      for (const t of terms) {
        const re = new RegExp(escapeRegExp(t), "g");
        const m = lowerContent.match(re);
        if (m) contentScore += m.length;
      }
    }

    if (pathScore > 0 || lineMatches.length > 0) {
      hits.push({
        path: f.path,
        lines: f.lines,
        matches: lineMatches,
        path_score: pathScore,
        content_score: contentScore,
      });
    }
  }

  hits.sort((a, b) => (b.path_score + b.content_score) - (a.path_score + a.content_score));
  return hits.slice(0, limit);
}

/**
 * Read a file from the index. For follow-up "show me line 50-80 of X"
 * type questions. If the file was truncated at index time, only the
 * truncated portion is available — caller must understand that limit.
 */
export async function readCode(
  filePath: string,
  opts?: { line_start?: number; line_end?: number },
): Promise<{ path: string; lines: number; truncated: boolean; excerpt: string } | null> {
  const idx = await loadIndex();
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const entry = idx.files.find((f) => f.path === norm);
  if (!entry) return null;

  const start = Math.max(1, opts?.line_start ?? 1);
  const end = Math.min(entry.lines, opts?.line_end ?? Math.min(entry.lines, start + 80));
  const lines = entry.content.split("\n");
  const slice = lines.slice(start - 1, end).map((line, i) => `${start + i}: ${line}`);
  return {
    path: entry.path,
    lines: entry.lines,
    truncated: entry.truncated,
    excerpt: slice.join("\n"),
  };
}

export async function indexStats(): Promise<{
  file_count: number;
  total_bytes: number;
  generated_at: string;
}> {
  const idx = await loadIndex();
  return {
    file_count: idx.file_count,
    total_bytes: idx.total_bytes,
    generated_at: idx.generated_at,
  };
}
