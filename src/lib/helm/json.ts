// src/lib/helm/json.ts
// Tolerant JSON parsing for LLM output. Handles: markdown ``` fences,
// stray prose around the object, and the common failure where the model
// puts RAW newlines/tabs inside string values (invalid JSON). The latter
// are escaped to \n/\r/\t so intended line breaks survive the parse.

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

export function parseLooseJson(raw: string): unknown {
  const noFence = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const candidates = [noFence];
  const s = noFence.indexOf("{");
  const e = noFence.lastIndexOf("}");
  if (s >= 0 && e > s) candidates.push(noFence.slice(s, e + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
    try { return JSON.parse(escapeControlInStrings(c)); } catch { /* try next */ }
  }
  throw new Error("no parseable JSON :: " + noFence.slice(0, 500));
}
