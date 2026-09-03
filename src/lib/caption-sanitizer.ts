// @ts-nocheck
/**
 * Caption sanitizer — the last line of defence before any AI-written
 * caption reaches Instagram. Two brand rules that prompts alone keep
 * failing to enforce (2026-09-03 audit):
 *
 *   1. No long dashes, ever (George's site-wide rule). Em/en dashes
 *      between words become ", "; between digits they become a plain
 *      hyphen ("18:00–19:30" → "18:00-19:30").
 *
 *   2. No caption may end mid-sentence. The 2026-09-02 M/Y SEA U post
 *      went live cut off at "across various luxury" — the model hit
 *      its token budget and the raw output shipped as-is. If the prose
 *      doesn't end in sentence-final punctuation, we drop the trailing
 *      fragment (same rule as the site's snippet hygiene sweep).
 *
 * The hashtag block (trailing lines made of #tags) is preserved
 * untouched — only the prose above it is sanitized.
 */

const SENTENCE_END = /[.!?…"”)\]]$/;

function isHashtagLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const tokens = t.split(/\s+/);
  return tokens.length > 0 && tokens.every((w) => w.startsWith("#"));
}

function scrubDashes(text: string): string {
  return (
    text
      // Digit ranges keep a plain hyphen: "18:00–19:30", "20–40%".
      .replace(/(\d)\s*[—–]\s*(?=\d)/g, "$1-")
      // Everything else: dash becomes a comma pause.
      .replace(/\s*[—–]+\s*/g, ", ")
      // Artefacts: ", ," / double commas / space before punctuation.
      .replace(/,\s*,/g, ",")
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/,\s*([.!?])/g, "$1")
  );
}

function trimIncompleteSentence(prose: string): string {
  const t = prose.trimEnd();
  if (!t) return t;
  // Allow a caption to end on a lone emoji after the final sentence.
  const emojiTail = t.match(/(\s*[☀-➿\u{1F300}-\u{1FAFF}]+)$/u);
  const core = emojiTail ? t.slice(0, t.length - emojiTail[1].length).trimEnd() : t;
  if (SENTENCE_END.test(core)) return t;
  // Cut back to the last completed sentence, if there is one.
  const lastEnd = Math.max(
    core.lastIndexOf("."),
    core.lastIndexOf("!"),
    core.lastIndexOf("?"),
  );
  if (lastEnd > 40) {
    return core.slice(0, lastEnd + 1) + (emojiTail ? emojiTail[1] : "");
  }
  // No usable sentence boundary — return unchanged rather than gut it;
  // the caller's quality guard will judge the caption as a whole.
  return t;
}

export function sanitizeCaption(raw: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return raw ?? "";
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  // Split trailing hashtag block off (consecutive hashtag/blank lines
  // at the very end).
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t === "" || isHashtagLine(lines[i])) {
      cut = i;
      continue;
    }
    break;
  }
  const proseLines = lines.slice(0, cut);
  const tagLines = lines.slice(cut);

  let prose = scrubDashes(proseLines.join("\n"));
  prose = trimIncompleteSentence(prose);

  const tail = tagLines.join("\n").replace(/^\n+/, "");
  return tail ? `${prose}\n\n${tail.trim()}` : prose;
}
