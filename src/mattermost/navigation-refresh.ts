export async function refreshNavigation<T, Load>(
  signal: AbortSignal | undefined,
  begin: () => Promise<Load | null>,
  fetchRows: (load: Load) => Promise<T>,
  publish: (load: Load, rows: T) => Promise<boolean>,
  cancel: (load: Load) => Promise<void>,
) {
  signal?.throwIfAborted();
  const load = await begin();
  if (load === null) {
    signal?.throwIfAborted();
    return false;
  }
  let rows: T;
  try {
    signal?.throwIfAborted();
    rows = await fetchRows(load);
    signal?.throwIfAborted();
  } catch (error) {
    try {
      await cancel(load);
    } catch (closeError) {
      if (closeError !== "unknown_connection" && closeError !== "cancelled")
        throw closeError;
    }
    throw error;
  }
  // The native resource is consumed by publication even when the payload is rejected.
  return publish(load, rows);
}
