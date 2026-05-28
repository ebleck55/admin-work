import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chief of Staff",
  description:
    "Evidence-grounded GTM intelligence across pipeline, CS, team, initiatives, FinServ, and competitive.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
