// Bump this whenever the seed catalog content changes (products, bundles,
// recipes, descriptions). The Netlify Function compares it with the database's
// `PRAGMA user_version` on a cold start and re-runs the seed when the stored
// catalog is older, so content updates reach a snapshot-backed production DB
// without discarding orders or customers.
export const CATALOG_VERSION = 5;
