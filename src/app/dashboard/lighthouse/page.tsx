import LighthouseClient from "./LighthouseClient";

// THE LIGHTHOUSE — the closeness engine (29/8/2026).
// Server wrapper only; everything lives in the client component.
export const dynamic = "force-dynamic";

export default function Page() {
  return <LighthouseClient />;
}
