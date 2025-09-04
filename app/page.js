// app/page.js
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">Welcome to Putter Prices</h1>
      <p className="mb-6 text-lg text-center max-w-xl">
        Search and compare golf putter prices from across the internet. 
        We aggregate listings so you can find the best deals fast.
      </p>
      <Link
        href="/putters"
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Browse Putters
      </Link>
    </main>
  );
}
