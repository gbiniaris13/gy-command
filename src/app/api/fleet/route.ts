import { NextResponse } from "next/server";

const SANITY_PROJECT_ID = "ecqr94ey";
const SANITY_DATASET = "production";
const SANITY_API_VERSION = "2023-11-09";

export const dynamic = "force-dynamic";
export const revalidate = 3600; // Cache for 1 hour

export async function GET() {
  try {
    const query = encodeURIComponent(
      '*[_type == "yacht"] | order(name asc) { name, "slug": slug.current, subtitle, length, sleeps, weeklyRatePrice, yachtType, fleetTier, "image": mainImage.asset->url }'
    );

    const res = await fetch(
      `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}?query=${query}`,
      { next: { revalidate: 3600 } }
    );

    if (!res.ok) {
      throw new Error(`Sanity API error: ${res.status}`);
    }

    const data = await res.json();
    const yachts = (data.result || []).map((y: Record<string, unknown>) => {
      // Determine type from name prefix
      const name = (y.name as string) || "";
      let type = "Motor";
      if (name.startsWith("S/CAT") || name.startsWith("P/CAT")) type = "Catamaran";
      else if (name.startsWith("S/Y")) type = "Sailing";
      else if (name.startsWith("M/Y")) type = "Motor";
      else if (name.startsWith("P/CAT")) type = "Power Cat";

      return {
        name,
        slug: y.slug,
        subtitle: y.subtitle,
        length: y.length,
        sleeps: parseInt(String(y.sleeps || "0")) || 0,
        price: y.weeklyRatePrice || "",
        tier: y.fleetTier || "private",
        type,
        image: y.image || null,
      };
    });

    return NextResponse.json({ yachts, count: yachts.length });
  } catch (error) {
    console.error("[Fleet API] Error:", error);
    return NextResponse.json({ yachts: [], count: 0, error: "Failed to fetch fleet" }, { status: 500 });
  }
}
