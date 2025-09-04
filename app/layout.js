// app/layout.js
import "./globals.css";

export const metadata = {
  title: "Putter Prices",
  description: "Compare golf putter prices across the web",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
