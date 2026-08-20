/**
 * Main-thread time-slicing policy for the SearchableItemList filter loop.
 *
 * The filter loop walks the sorted items on the main thread. Every
 * SEARCH_FILTER_YIELD_CHECK_INTERVAL items it checks whether more than
 * SEARCH_FILTER_YIELD_MAX_DELAY_MS of work have elapsed since the last
 * partial publish; if so it publishes the partial result and yields to the
 * main thread before continuing. This keeps a large search from occupying the
 * main thread for too long.
 */

/**
 * How often (in items processed) the filter loop re-checks its elapsed-time
 * budget. Kept as a power of two so the modulo check is cheap.
 */
export const SEARCH_FILTER_YIELD_CHECK_INTERVAL = 128;

/**
 * Maximum time budget (ms) a filter loop slice may occupy on the main thread
 * before it must publish partial results and yield.
 */
export const SEARCH_FILTER_YIELD_MAX_DELAY_MS = 16;
