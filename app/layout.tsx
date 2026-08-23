import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const ledgerMono = JetBrains_Mono({
  variable: "--font-ledger-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Firmline — AI Revenue Recovery",
  description: "An AI agent that recovers revenue and stops the moment it's not allowed to keep going.",
};

const NAV_LINKS = [
  { href: "/", label: "Batch" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/counterfactual", label: "Counterfactual" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${ledgerMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ink-navy text-navy-text">
        <header className="border-b border-border-soft">
          <nav className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-extrabold tracking-tight">Firmline</span>
              <span className="hidden sm:inline text-xs text-navy-muted">revenue recovery, compliantly</span>
            </Link>
            <div className="flex items-center gap-1 text-sm">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-3 py-1.5 text-navy-muted hover:text-navy-text hover:bg-ink-navy-raised transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass-gold"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border-soft py-6 text-center text-xs text-navy-muted">
          Synthetic data, Razorpay test mode. No real money moves. Built for the Razorpay AI Buildathon — Track 03.
        </footer>
      </body>
    </html>
  );
}
