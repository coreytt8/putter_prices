import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

const LABS_ON = process.env.NEXT_PUBLIC_LABS === "1";

export default function CompareLabs() {
  const router = useRouter();
  const [idsInput, setIdsInput] = useState("");
  const [rows, setRows] = useState([]);

  // read ids from query (?ids=...)
  const queryIds = useMemo(() => {
    const s = (router.query.ids || "").toString();
    return s.split(",").map(x => x.trim()).filter(Boolean);
  }, [router.query.ids]);

  useEffect(() => {
    if (!LABS_ON) return;
    const ids = queryIds.length ? queryIds.join(",") : "scotty-newport-2,odyssey-whitehot-7";
    setIdsInput(ids);
    fetch(`/api/specs?ids=${encodeURIComponent(ids)}`)
      .then(r => r.json())
      .then(j => setRows(j.specs || []))
      .catch(() => setRows([]));
  }, [queryIds]);

  if (!LABS_ON) {
    return <div style={{ padding: 24 }}>Labs disabled. Set <code>NEXT_PUBLIC_LABS=1</code> locally.</div>;
  }

  const reload = async () => {
    const url = `/labs/compare?ids=${encodeURIComponent(idsInput)}`;
    router.replace(url, undefined, { shallow: true });
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1>Compare (Labs)</h1>
      <p style={{ color: "#666", marginTop: 4 }}>This page is isolated from production.</p>

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input
          value={idsInput}
          onChange={e => setIdsInput(e.target.value)}
          style={{ flex: 1, padding: 8 }}
          placeholder="comma-separated ids e.g. scotty-newport-2,odyssey-2ball-ten"
        />
        <button onClick={reload}>Load</button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Spec</th>
              {rows.map(r => (
                <th key={r.id} style={{ textAlign: "left", padding: 8 }}>
                  {r.brand} {r.model}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["Head Type", "headType"],
              ["Toe Hang", "toeHang"],
              ["Balance", "balance"],
              ["Lengths", "lengths"],
              ["Loft (°)", "loft"],
              ["Lie (°)", "lie"],
              ["Face", "face"],
              ["Alignment", "alignment"],
              ["Head Weight (g)", "weightHead"]
            ].map(([label, key]) => (
              <tr key={key}>
                <td style={{ padding: 8, fontWeight: 600 }}>{label}</td>
                {rows.map(r => (
                  <td key={r.id + key} style={{ padding: 8 }}>
                    {Array.isArray(r[key]) ? r[key].join(", ") : (r[key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <small style={{ color: "#888" }}>
          Tip: add <code>?ids=scotty-newport-2,odyssey-whitehot-7,taylormade-spider-tour</code> to the URL.
        </small>
      </div>
    </div>
  );
}
