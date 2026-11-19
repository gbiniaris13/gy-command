// Text the drawn pictures (stories, carousel cards) can safely carry.
//
// The picture renderer has one bundled font. A character outside it makes
// the renderer fetch another font from the internet at draw time, with no
// time limit: that is what stalled the story composer until 2026-11-19.
// Everything drawn goes through here first, so only Basic Latin and
// Latin-1 ever reach the renderer.

export function plainText(input: string, max: number): string {
  return String(input ?? "")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[–—‒―]/g, ", ")
    .replace(/…/g, "...")
    .replace(/[•∙⋅]/g, "·")
    // The euro sign is outside Latin-1. Dropping it turned "EUR 34,900"
    // into a bare "34,900" on the first cost card; spell it instead.
    .replace(/€\s?/g, "EUR ")
    .replace(/[^\x20-\x7E -ÿ]/g, "")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}
