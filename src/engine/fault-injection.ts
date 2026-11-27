let tickFaultPending = false;

/** Debug API arms one deterministic simulation-tick failure. */
export function injectFault(kind: 'tick'): void {
  if (kind === 'tick') tickFaultPending = true;
}

/** Called at the beginning of a real simulation tick; consumes the armed fault once. */
export function throwPendingTickFault(): void {
  if (!tickFaultPending) return;
  tickFaultPending = false;
  throw new Error('Injected fault');
}
