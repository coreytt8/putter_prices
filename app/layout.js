// app/layout.js
import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "PutterIQ – Golf Putter Price Comparison",
  description:
    "Compare live prices for golf putters from eBay and more. Filter by brand, price, and condition.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        {/* Site Header */}
        <header className="border-b border-gray-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              {/* Logo placeholder */}
              <Link href="/" className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
                  {/* Simple monogram logo */}
                  <span className="text-sm font-bold">PIQ</span>
                </div>
                <span className="text-lg font-semibold tracking-tight">
                  PutterIQ
                </span>
              </Link>
            </div>

            <nav className="hidden items-center gap-5 sm:flex">
              <Link
                href="/putters"
                className="text-sm text-gray-700 hover:text-blue-700"
              >
                Putters
              </Link>
              {/* Add more pages later, e.g., /about, /sold, /alerts */}
            </nav>

            <div className="sm:hidden">
              {/* Mobile: simple link to main page */}
              <Link
                href="/putters"
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Browse
              </Link>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="min-h-[72vh]">{children}</div>

        {/* Footer with affiliate disclosure */}
        <footer className="mt-12 border-t border-gray-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <h3 className="text-sm font-semibold">PutterIQ</h3>
                <p className="mt-2 text-sm text-gray-600">
                  Live price comparison and filters for golf putters.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-semibold">Links</h3>
                <ul className="mt-2 space-y-1 text-sm text-gray-600">
                  <li>
                    <Link href="/putters" className="hover:text-blue-700">
                      Putters
                    </Link>
                  </li>
                  {/* Future:
                  <li><Link href="/sold" className="hover:text-blue-700">Recently Sold</Link></li>
                  <li><Link href="/about" className="hover:text-blue-700">About</Link></li>
                  */}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold">Disclosure</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                  Some links on this site are affiliate links. We may earn a
                  commission if you click through and make a purchase—at no
                  extra cost to you.
                </p>
              </div>
            </div>

            <div className="mt-8 border-t border-gray-100 pt-4 text-xs text-gray-500">
              © {new Date().getFullYear()} PutterIQ. All rights reserved.
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
