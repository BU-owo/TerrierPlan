// Pages with debounced saves (Planner plan/profile writes, Scheduler draft)
// register a function that sends whatever is still pending, using their own
// existing flush code. The "update available" banner (UpdateBanner.jsx)
// calls flushAllPendingWrites before it reloads, and only reloads when this
// resolves true.
const flushers = new Set();

// `flush` may return a boolean, a Promise of one, or nothing (= nothing
// pending / saved). Returns an unregister function (use it as an effect
// cleanup).
export function registerPendingWriteFlush(flush) {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

// True when every registered flush succeeded within `timeoutMs`; false if
// any returned false, threw, or hung (e.g. offline).
export async function flushAllPendingWrites(timeoutMs = 10000) {
  const results = [...flushers].map((flush) => {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const run = Promise.resolve()
      .then(() => flush())
      .then((result) => result !== false, () => false);
    return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
  });
  return (await Promise.all(results)).every(Boolean);
}
