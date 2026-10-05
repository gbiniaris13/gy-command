// src/lib/helm/json.ts
// Tolerant JSON parsing for LLM output. Handles: markdown ``` fences,
// stray prose around the object, the common failure where the model puts
// RAW newlines/tabs inside string values (invalid JSON), and, since
// 2026-10-05 (a generate failed on "no parseable JSON" for George), two
// more: an UNESCAPED double quote inside a string value (the model quoting
// a yacht name or a phrase), and a reply CUT OFF mid-string (the string
// and the braces are closed so what was written survives).

function escapeControlInStrings(s: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") { out += c + (s[i + 1] ?? ""); i++; continue; } // keep escape pairs intact
      if (c === '"') { inStr = false; out += c; continue; }
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      out += c;
    } else {
      if (c === '"') inStr = true;
      out += c;
    }
  }
  return out;
}

/** A quote inside a string value only ends the string when what follows
 *  (after whitespace) is JSON punctuation: , } ] or a key's colon. Any
 *  other quote is text and gets escaped. Also closes a cut-off string and
 *  any open braces/brackets at the end. */
function repairQuotesAndTruncation(s: string): string {
  let out = "";
  let inStr = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") { out += c + (s[i + 1] ?? ""); i++; continue; }
      if (c === '"') {
        const rest = s.slice(i + 1).replace(/^\s*/, "");
        const closes = rest === "" || /^[,}\]]/.test(rest) || /^:/.test(rest);
        if (closes) { inStr = false; out += c; } else { out += '\\"'; }
        continue;
      }
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      out += c;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
      else if (c === "}" || c === "]") stack.pop();
      out += c;
    }
  }
  if (inStr) out += '"';
  // drop a dangling ", " or ": " left by the cut
  out = out.replace(/[,:]\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

export function parseLooseJson(raw: string): unknown {
  const noFence = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const candidates = [noFence];
  const s = noFence.indexOf("{");
  const e = noFence.lastIndexOf("}");
  if (s >= 0 && e > s) candidates.push(noFence.slice(s, e + 1));
  if (s >= 0) candidates.push(noFence.slice(s)); // a cut-off reply has no final brace
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
    try { return JSON.parse(escapeControlInStrings(c)); } catch { /* try next */ }
    try { return JSON.parse(repairQuotesAndTruncation(c)); } catch { /* try next */ }
  }
  throw new Error("no parseable JSON :: " + noFence.slice(0, 500));
}
