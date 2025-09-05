import "./globals.css";
import Script from "next/script";

export const metadata = {
  title: "PutterIQ – Golf Putter Price Comparison",
  description: "Compare golf putter prices from eBay and other sources.",
};

export default function RootLayout({ children }) {
  const pub = process.env.NEXT_PUBLIC_EPN_PUBLISHER_ID; // must be set in Vercel
  return (
    <html lang="en">
      <head />
      <body>
        {children}

        {/* EPN Smart Links (afterInteractive ensures it runs after hydration) */}
        {!!pub && (
          <Script
            src="https://epn.ebay.com/static/js/epn-smart-frontend.js"
            strategy="afterInteractive"
            data-epn-publisher-id={pub}
          />
        )}
      </body>
    </html>
  );
}
