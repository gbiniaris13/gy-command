"use client";

// Tiny client island for the "Print / save as PDF" button. Lives
// here because the surrounding print + preference-sheet pages are
// server components — onClick handlers and globalThis.print() are
// not valid inside server components, which is why both pages
// were 500-ing with "A server error occurred" when George clicked
// them from the cabin detail page.

export default function PrintButton({
  label = "Print / save as PDF",
}: {
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => globalThis.print()}
      style={{
        background: "#C9A84C",
        color: "#0D1B2A",
        padding: "8px 16px",
        border: 0,
        fontSize: 10,
        letterSpacing: 2,
        textTransform: "uppercase",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
