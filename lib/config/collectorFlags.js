const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);

function normalizeEnv(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

export function isCollectorModeEnabled() {
  const raw = normalizeEnv(process.env.COLLECTOR_MODE, "");
  if (!raw) return false;
  return TRUTHY.has(raw.toLowerCase());
}

export function getHomepageCacheWriteSecret() {
  const preferred = normalizeEnv(process.env.HOMEPAGE_CACHE_WRITE_SECRET, "");
  if (preferred) return preferred;
  return normalizeEnv(process.env.CRON_SECRET, "");
}

export function getTopDealsCacheKey() {
  return normalizeEnv(process.env.TOP_DEALS_CACHE_KEY, "default") || "default";
}

export function getLeaderboardCacheKey() {
  return normalizeEnv(process.env.LEADERBOARD_CACHE_KEY, "default") || "default";
}

export function getAllowedCacheSecrets() {
  const secrets = new Set();
  const homepageSecret = getHomepageCacheWriteSecret();
  if (homepageSecret) secrets.add(homepageSecret);
  const cronSecret = normalizeEnv(process.env.CRON_SECRET, "");
  if (cronSecret) secrets.add(cronSecret);
  return Array.from(secrets);
}

