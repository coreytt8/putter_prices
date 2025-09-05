export default function AboutPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">About PutterIQ</h1>

      <section className="mt-6 space-y-4 text-gray-700">
        <p>
          PutterIQ was created with one simple goal: to make it easier for
          golfers to find the right putter at the best price. Instead of
          searching across multiple sites, PutterIQ lets you compare live
          listings in one place.
        </p>

        <p>
          Our search pulls listings directly from eBay and other retailers,
          giving you a clear view of what’s available right now. You can filter
          by brand, price, and condition, then click through to complete your
          purchase on the retailer’s site.
        </p>

        <p>
          Some links on this site are affiliate links. This means we may earn a
          small commission if you make a purchase, at no extra cost to you. That
          support helps us keep the site running and add new features like
          advanced filters and recently sold putter data.
        </p>

        <p>
          Whether you’re after a classic Scotty Cameron, a modern TaylorMade
          Spider, or a L.A.B. Golf putter, PutterIQ is here to help you shop
          smarter.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Contact</h2>
        <p className="mt-2 text-gray-700">
          Have feedback or questions? Get in touch at{" "}
          <a
            href="mailto:your@email.com"
            className="text-blue-600 hover:underline"
          >
            your@email.com
          </a>
        </p>
      </section>
    </main>
  );
}
