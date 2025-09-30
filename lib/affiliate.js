const DEFAULT_EPN = {
  toolid: "10001",
  mkcid: "1",
  mkrid: "711-53200-19255-0",
  siteid: "0",
  mkevt: "1",
};

function isEbayHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h.includes("rover.ebay.")) return false;
  return h.includes(".ebay.");
}

export function decorateEbayUrl(raw, overrides = {}) {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (!isEbayHost(u.hostname)) return raw;

    const campid = overrides.campid ?? process.env.EPN_CAMPID ?? "";
    if (!campid) return raw;

    const params = {
      mkcid: overrides.mkcid ?? process.env.EPN_MKCID ?? DEFAULT_EPN.mkcid,
      mkrid: overrides.mkrid ?? process.env.EPN_MKRID ?? DEFAULT_EPN.mkrid,
      siteid: overrides.siteid ?? process.env.EPN_SITEID ?? DEFAULT_EPN.siteid,
      campid,
      customid: overrides.customid ?? process.env.EPN_CUSTOMID ?? "",
      toolid: overrides.toolid ?? process.env.EPN_TOOLID ?? DEFAULT_EPN.toolid,
      mkevt: overrides.mkevt ?? process.env.EPN_MKEVT ?? DEFAULT_EPN.mkevt,
    };

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value).length) {
        u.searchParams.set(key, String(value));
      }
    }

    return u.toString();
  } catch {
    return raw;
  }
}
