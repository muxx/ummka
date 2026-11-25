export async function refreshNavigation<T>(
  signal: AbortSignal | undefined,
  begin: () => Promise<number | null>,
  fetchRows: () => Promise<T>,
  publish: (load: number, rows: T) => Promise<boolean>,
  cancel: (load: number) => Promise<void>,
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
    rows = await fetchRows();
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
