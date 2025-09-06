// app/layout.js
import "./globals.css";

export const metadata = {
  title: "PutterIQ — Compare Golf Putter Prices",
  description:
    "Real-time golf putter price comparison across marketplaces. Find the best deals on Scotty Cameron, TaylorMade, Ping, Odyssey, L.A.B., and more.",
  metadataBase: new URL("https://www.putteriq.com"),
  openGraph: {
    title: "PutterIQ — Compare Golf Putter Prices",
    description:
      "Real-time price comparison across marketplaces. Find the best deal on your next putter.",
    url: "https://www.putteriq.com",
    siteName: "PutterIQ",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "PutterIQ" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PutterIQ — Compare Golf Putter Prices",
    description:
      "Real-time price comparison across marketplaces. Find the best deal on your next putter.",
    images: ["/og.png"],
  },
};

function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <a href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white font-semibold">
            P
          </div>
          <span className="text-lg font-semibold tracking-tight">PutterIQ</span>
        </a>

        <nav className="flex items-center gap-4 text-sm">
          <a href="/putters" className="nav-link">Putters</a>
          {/* Future: <a href="/saved" className="nav-link">Saved</a> */}
          {/* Future: <a href="/about" className="nav-link">About</a> */}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-200">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-gray-500">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} PutterIQ. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <a href="/terms" className="hover:text-gray-700">Terms</a>
            <a href="/privacy" className="hover:text-gray-700">Privacy</a>
            <a href="/contact" className="hover:text-gray-700">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
