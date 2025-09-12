// app/sitemap.ts
export default async function sitemap() {
  const base = "https://www.putteriq.com";
  return [
    { url: `${base}/`, lastModified: new Date() },
    { url: `${base}/putters`, lastModified: new Date() },
    { url: `${base}/about`, lastModified: new Date() },
  ];
}
