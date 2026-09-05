import type { CancellationToken, Disposable } from "vscode";

/** Optional bookkeeping must not hold a completed AI answer indefinitely. */
export function waitWithFallback<T>(
  operation: () => PromiseLike<T>,
  timeoutMs: number,
  fallback: T,
  token?: CancellationToken,
  cancelOperation: () => void = () => {}
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: Disposable | undefined;
    const finish = (value: T, cancel = false): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      subscription?.dispose();
      if (cancel) cancelOperation();
      resolve(value);
    };
    if (token?.isCancellationRequested) {
      finish(fallback, true);
      return;
    }
    timer = setTimeout(() => finish(fallback, true), timeoutMs);
    subscription = token?.onCancellationRequested(() => finish(fallback, true));
    // Account for a token cancelled while its listener was being installed.
    if (token?.isCancellationRequested) {
      subscription?.dispose();
      finish(fallback, true);
      return;
    }
    try {
      Promise.resolve(operation()).then(
        (value) => finish(value),
        () => finish(fallback, true)
      );
    } catch {
      finish(fallback, true);
    }
  });
}
