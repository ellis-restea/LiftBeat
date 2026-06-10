import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "LiftBeat",
  description:
    "High BPM during sets, low BPM during rest — Spotify-powered workout music.",
  applicationName: "LiftBeat",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LiftBeat",
  },
  // Next.js generates mobile-web-app-capable (Android) from appleWebApp.capable
  // but not the iOS-specific tag — add it explicitly so standalone mode works on iPhone
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111116",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
