const DROP_TOKENS = new Set([
  'weight',
  'weights',
  'screw',
  'screws',
  'wrench',
  'wrenches',
  'tool',
  'tools',
  'plate',
  'plates',
  'cover',
  'covers',
  'headcover',
  'headcovers',
  'kit',
  'kits',
  'head',
  'shaft',
  'grip',
]);

const MODEL_ALLOWLIST = [
  'anser',
  'b60',
  'fastback',
  'fetch',
  'futura',
  'inovai',
  'jailbird',
  'mezz',
  'napa',
  'newport',
  'phantom',
  'pld',
  'queen',
  'rossie',
  'scotty',
  'select',
  'spider',
  'squareback',
  'studio',
  'truss',
  'tyne',
];

const MULTI_WORD_DROPS = [
  'head only',
  'shaft only',
  'grip only',
  'cover only',
];

const HEADCOVER_WITH_PUTTER_RX = /(with|w\/|includes|incl\.?|plus)\s+(a\s+)?head\s?cover/;

function tokenize(text) {
  return text
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function evaluateAccessoryGuard(title = '') {
  const text = String(title || '').toLowerCase();
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      isAccessory: true,
      reason: 'empty_title',
      hasCoreToken: false,
      dropTokens: [],
    };
  }

  const hasPutterToken = /\bputter(s)?\b/.test(trimmed);
  const hasModelToken = MODEL_ALLOWLIST.some((token) =>
    new RegExp(`\\b${token}\\b`).test(trimmed)
  );

  if (MULTI_WORD_DROPS.some((phrase) => trimmed.includes(phrase))) {
    return {
      isAccessory: true,
      reason: 'explicit_only_phrase',
      hasCoreToken: hasPutterToken || hasModelToken,
      dropTokens: MULTI_WORD_DROPS.filter((phrase) => trimmed.includes(phrase)),
    };
  }

  const tokens = tokenize(trimmed);
  const dropTokens = tokens.filter((token) => DROP_TOKENS.has(token));

  const mentionsHeadcover = /head\s?cover/.test(trimmed);
  if (mentionsHeadcover && !HEADCOVER_WITH_PUTTER_RX.test(trimmed)) {
    return {
      isAccessory: true,
      reason: 'headcover',
      hasCoreToken: hasPutterToken || hasModelToken,
      dropTokens,
    };
  }

  if (!hasPutterToken && !hasModelToken) {
    return {
      isAccessory: true,
      reason: dropTokens.length ? 'accessory_tokens_without_core' : 'missing_core_token',
      hasCoreToken: false,
      dropTokens,
    };
  }

  if (dropTokens.length >= 3 || (dropTokens.length >= 2 && !hasPutterToken)) {
    return {
      isAccessory: true,
      reason: 'drop_token_threshold',
      hasCoreToken: hasPutterToken || hasModelToken,
      dropTokens,
    };
  }

  if (tokens.length <= 2 && dropTokens.length) {
    return {
      isAccessory: true,
      reason: 'token_short_title',
      hasCoreToken: hasPutterToken || hasModelToken,
      dropTokens,
    };
  }

  return {
    isAccessory: false,
    reason: null,
    hasCoreToken: hasPutterToken || hasModelToken,
    dropTokens,
  };
}

export function isAccessoryOrHeadcover(title = '') {
  return evaluateAccessoryGuard(title).isAccessory;
}
