import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { DeviceRevocationGuard } from "@/components/sync/DeviceRevocationGuard";
import "./globals.css";

// Auto-hospedadas pelo next/font (nada é pedido ao Google no navegador): funcionam sem internet
// como qualquer outro arquivo do build.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Na Escuta · Gestão de eventos",
    template: "%s · Na Escuta",
  },
  description:
    "Sistema de gestão operacional para produtoras de eventos, com suporte offline-first.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

// Sem `maximumScale`: travar o zoom impede quem enxerga pouco de ampliar a tela.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f2ea",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${body.variable} ${display.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        {/* Em TODAS as páginas, inclusive /login: é onde cai quem perdeu o vínculo. */}
        <DeviceRevocationGuard />
        {children}
      </body>
    </html>
  );
}
