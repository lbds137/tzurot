/**
 * pgvector search constants.
 */

/** Session settings applied to every vector-distance (`<=>`) query. */
export const PGVECTOR_SEARCH = {
  /**
   * `ivfflat.probes` for vector queries: the GUC's maximum (pgvector's range is
   * 1..32768), which is >= the `lists` of every IVFFlat index, so any IVFFlat
   * scan visits every list and returns the exact nearest neighbours within the
   * query's WHERE filters. At the default of 1 the scan read one list and then
   * post-filtered by persona/personality, missing most true neighbours.
   */
  IVFFLAT_PROBES: 32768,
} as const;
