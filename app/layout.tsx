import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter, Manrope } from "next/font/google";
import { TopNav } from "./_components/top-nav";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TruthLens",
  description:
    "TruthLens is an AI-powered claim verification platform for analysts and researchers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ClerkProvider>
          <div className="app-bg" />
          <div className="relative z-10 flex min-h-full flex-col">
            <TopNav />
            <main className="flex-1">{children}</main>
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
