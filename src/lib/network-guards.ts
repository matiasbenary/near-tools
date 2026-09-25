// ponytail: module-level Set, not context — one producer, one consumer, no re-render needed
type NetworkGuard = () => string | null;

const guards = new Set<NetworkGuard>();

/** Register a warning to show before a network switch. Returns an unregister fn. */
export function registerNetworkGuard(guard: NetworkGuard) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function networkBlockReasons() {
  return [...guards].map((guard) => guard()).filter((reason): reason is string => !!reason);
}
