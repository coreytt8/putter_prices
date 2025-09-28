// lib/data/tourPutters2024.js
// Curated list of tour-validated putter models used to anchor the 2024 lineup view.
// Keep modelKey values aligned with items.model_key (lowercase, brand stripped) so
// the background collectors continue writing price snapshots for these entries.

export const DATAGOLF_WHATS_IN_THE_BAG_URL =
  'https://www.datagolf.com/whats-in-the-bag';

export const TOUR_PUTTERS_2024 = [
  {
    modelKey: 'newport 2',
    displayName: 'Scotty Cameron Newport 2',
    usageRank: 1,
    playerCount: 38,
    sourceUrl: DATAGOLF_WHATS_IN_THE_BAG_URL,
  },
  {
    modelKey: 'spider tour',
    displayName: 'TaylorMade Spider Tour',
    usageRank: 2,
    playerCount: 21,
    sourceUrl: DATAGOLF_WHATS_IN_THE_BAG_URL,
  },
  {
    modelKey: 'jailbird',
    displayName: 'Odyssey Jailbird',
    usageRank: 3,
    playerCount: 17,
    sourceUrl: DATAGOLF_WHATS_IN_THE_BAG_URL,
  },
  {
    modelKey: 'ds72',
    displayName: 'Ping DS72',
    usageRank: 4,
    playerCount: 15,
    sourceUrl: DATAGOLF_WHATS_IN_THE_BAG_URL,
  },
  {
    modelKey: 'queen b',
    displayName: 'Bettinardi Queen B',
    usageRank: 5,
    playerCount: 12,
    sourceUrl: DATAGOLF_WHATS_IN_THE_BAG_URL,
  },
  {
    modelKey: 'mezz 1 max',
    displayName: 'LAB Golf Mezz 1 Max',
    usageRank: 6,
    playerCount: 10,
    sourceUrl: DATAGOLF_WHATS_IN_THE_BAG_URL,
  },
];
