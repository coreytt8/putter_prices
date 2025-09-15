export default function handler(req, res) {
  try {
    const data = require("../../data/putter_specs.json");
    const ids = (req.query.ids || "").toString().split(",").map(s => s.trim()).filter(Boolean);
    const out = ids.length ? data.filter(x => ids.includes(x.id)) : data;
    res.status(200).json({ ok: true, specs: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
