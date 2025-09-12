// app/robots.txt/route.ts
export function GET() {
  return new Response(
    `User-agent: *\nAllow: /\nSitemap: https://www.putteriq.com/sitemap.xml\n`,
    { headers: { "Content-Type": "text/plain" } }
  );
}
