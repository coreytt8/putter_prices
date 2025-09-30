# Tasks to Restore Headcover Search Results

## 1. Normalize headcover tokens across CTA and search
- Add the `"hc"` abbreviation (and spaced variants like `"head cover"`) to `HEAD_COVER_TOKEN_VARIANTS` in both `lib/sanitizeModelKey.js` and `pages/api/putters.js` so helpers share a consistent whitelist.
- Replace the CTA-specific `containsHeadCoverToken` check with a regex that accepts `headcover`, `head cover`, `head-cover`, and `hc`, ensuring headcover-only deals still strip the synthetic `putter` suffix.
- Export and reuse the shared regex inside `/pages/api/putters` (or introduce a small shared helper) so query normalization and tokenization recognize every headcover spelling.

## 2. Broaden server-side headcover detection and token cleanup
- Update `HEAD_COVER_TEXT_RX` in `pages/api/putters.js` to match `\bhc\b` in addition to the spaced variants.
- When `hasHeadcoverToken` is true, drop the literal `"hc"`, `"head"`, and `"cover"` fragments from the query-token list so title filtering only requires the canonical `headcover` surrogate.
- Remove forced `"putter"` tokens for headcover-intent queries inside `normalizeSearchQ` so accessory searches don’t insist on club keywords.

## 3. Relax accessory queries that include club specs
- Strip length (`35in`, `34"`, etc.) and dexterity (`rh`, `lh`, `right hand`, `left-handed`) tokens from the headcover query-token list before filtering listing titles.
- Ensure the relaxed token set still keeps meaningful model identifiers so listings stay relevant.

## 4. Preserve decimal model numbers in CTA queries
- Adjust `removeEmojiAndPunctuation` so it keeps punctuation between digits (e.g., `2.5`) when generating query variants.
- Confirm the sanitized phrases now emit `2.5` instead of `2 5` before the CTA query string is built.

## 5. Add regression coverage
- Extend `lib/__tests__/buildDealCtaHref.test.js` with fixtures covering:
  - Headcover labels that use `hc`, `head cover`, and `headcover` spellings.
  - Decimal model numbers (e.g., `Newport 2.5`) to ensure punctuation survives.
- Expand `pages/api/__tests__/putters.test.js` to exercise headcover queries containing:
  - Only the abbreviation (`"hc"`).
  - Spaced phrases (`"head cover"`).
  - Club specs like `35in` or `RH`, confirming listings lacking those tokens still return.
