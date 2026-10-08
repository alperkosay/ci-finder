import type { Metadata } from "next";
import "@ci-finder/react/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ciFinder",
  description: "File manager for React, Next.js, Node.js and Bun",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
