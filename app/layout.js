// app/layout.js
import "./globals.css";

export const metadata = {
  title: "PutterIQ – Golf Putter Price Comparison",
  description: "Compare golf putter prices from eBay and other sources.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* EPN Smart Links */}
        {process.env.NEXT_PUBLIC_EPN_PUBLISHER_ID && (
          <script
            async
            src="https://epn.ebay.com/static/js/epn-smart-frontend.js"
            data-epn-publisher-id={process.env.NEXT_PUBLIC_EPN_PUBLISHER_ID}
          />
        )}
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
