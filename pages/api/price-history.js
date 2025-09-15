export default async function handler(req, res) {
  const id = (req.query.id || "").toString();
  const series = [
    { t: "2025-06-01", price: 329 },
    { t: "2025-07-01", price: 309 },
    { t: "2025-08-01", price: 299 },
    { t: "2025-09-01", price: 289 }
  ];
  res.status(200).json({ ok: true, id, series });
}
