import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Metadata is a Next.js type — it checks the shape of title/description/etc.
export const metadata: Metadata = {
  title: "Meritly — Work Monitoring & Performance Management",
  description:
    "Assign tasks, submit work, track deadlines, and review employee performance — with AI-assisted ratings.",
};

// ReactNode = "anything React can render" — the standard type for children.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
