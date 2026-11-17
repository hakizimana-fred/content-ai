import type { Metadata } from "next";
import { Geist, Geist_Mono, Poppins, Montserrat, Inter, Anton, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { PlayerProvider } from "@/components/sound/player";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Caption fonts (self-hosted by Next at build time; no runtime request to Google)
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], display: "swap" });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], display: "swap" });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], display: "swap" });
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400", display: "swap" });
const bebas = Bebas_Neue({ variable: "--font-bebas", subsets: ["latin"], weight: "400", display: "swap" });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Content AI — Content Intelligence & Video Cutter",
  description: "Find the moments that matter and cut them with frame-accurate precision.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${poppins.variable} ${montserrat.variable} ${inter.variable} ${anton.variable} ${bebas.variable} dark h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col text-zinc-100"><PlayerProvider>{children}</PlayerProvider></body>
    </html>
  );
}
