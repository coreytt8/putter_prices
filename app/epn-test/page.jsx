export const metadata = { title: "EPN Test" };

export default function EpnTest() {
  const pub = process.env.NEXT_PUBLIC_EPN_PUBLISHER_ID;
  return (
    <html lang="en">
      <body style={{padding: 24, fontFamily: "system-ui, sans-serif"}}>
        <h1>EPN Smart Links Test</h1>
        <p>Publisher ID: <strong>{pub || "(missing!)"}</strong></p>

        <p>
          Raw eBay link (should be tagged on click):
          <br />
          <a href="https://www.ebay.com/itm/317227109131" id="test-link">
            View eBay Item
          </a>
        </p>

        {/* Load Smart Links exactly how EPN shows it */}
        {pub && (
          <script
            async
            src="https://epn.ebay.com/static/js/epn-smart-frontend.js"
            data-epn-publisher-id={pub}
          />
        )}
      </body>
    </html>
  );
}
