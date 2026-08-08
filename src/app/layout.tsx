import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "GY Command | George Yachts",
  description:
    "Command Center for George Yachts — Charter brokerage CRM and operations hub.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GY Command",
  },
  // 2026-08-08 - Google had indexed command.georgeyachts.com/login. It turned
  // up in Search Console as the domain's only "duplicate without user-selected
  // canonical", which is how we found it: an internal CRM sign-in page sitting
  // in public search results.
  //
  // noindex rather than a robots.txt disallow, deliberately. Blocking the
  // crawler would stop Google reading the very instruction that removes the
  // page, so an already-indexed URL would simply stay indexed with no snippet.
  // Letting it crawl and telling it not to index is what actually clears it.
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export const viewport: Viewport = {
  // 2026-05-20 — was #00ffc8 (electric cyan) for the old Alien
  // Mothership theme; now matches the calm operator theme's ivory
  // background so the iOS PWA status bar / browser chrome doesn't
  // flash neon when the app opens.
  themeColor: "#F8F5F0",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
