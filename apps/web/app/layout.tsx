import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import type { ReactNode } from "react";
import Providers from "../components/Providers";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Pointer Imóveis",
  description: "Captação e qualificação de leads imobiliários"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={poppins.variable}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
