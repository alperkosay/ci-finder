import type { Metadata } from "next";
import "@thefinder/react/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "theFinder",
  description: "File manager for React, Next.js, Node.js and Bun",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
