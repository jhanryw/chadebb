import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost, Pinyon_Script } from "next/font/google";
import { EVENT_CONTENT, getEventConfig } from "@/lib/event-config";
import "./globals.css";

const script = Pinyon_Script({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-script-next",
  fallback: ["Snell Roundhand", "Apple Chancery", "Brush Script MT", "cursive"],
});

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif-next",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const sans = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
  variable: "--font-sans-next",
  fallback: ["Helvetica Neue", "Arial", "system-ui", "sans-serif"],
});

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  let siteUrl: string | undefined;
  try {
    siteUrl = getEventConfig().siteUrl ?? undefined;
  } catch {
    siteUrl = undefined;
  }
  const description = `${EVENT_CONTENT.subtitle} ${EVENT_CONTENT.eventName}.`;
  return {
    ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
    title: `${EVENT_CONTENT.title} — Celebração de fé e gratidão`,
    description,
    // Convite privado: não indexar nos buscadores.
    robots: { index: false, follow: false },
    openGraph: {
      title: EVENT_CONTENT.title,
      description,
      type: "website",
      locale: "pt_BR",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbf8f2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${script.variable} ${serif.variable} ${sans.variable}`}>
      <body>
        <a
          href="#conteudo"
          className="visually-hidden focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-5 focus:py-3 focus:text-ivory"
        >
          Ir para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
