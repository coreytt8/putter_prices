import { MARKET_OPTIONS, loadSite, saveSite } from "@/lib/marketplaces";
import { useEffect, useState } from "react";

export default function MarketplaceSelect({ onChange }) {
  const [site, setSite] = useState("EBAY_US");

  useEffect(() => {
    const s = loadSite();
    setSite(s);
    if (onChange) onChange(s);
  }, []);

  const handle = (e) => {
    const v = e.target.value;
    setSite(v);
    saveSite(v);
    if (onChange) onChange(v);
  };

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span>Marketplace:</span>
      <select value={site} onChange={handle}>
        {MARKET_OPTIONS.map(opt => (
          <option key={opt.code} value={opt.code}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}
