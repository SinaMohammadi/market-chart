import type { Unsubscribe } from '../model/types.js';

export type EventMap = object;
export type Listener<T> = (payload: T) => void;

/**
 * Strongly typed event emitter.
 * - `on` returns an idempotent unsubscribe function.
 * - Listeners are isolated: a throwing listener is reported via `onError` and never stops the others.
 * - Emitting while (un)subscribing is safe: listeners are iterated over a snapshot.
 */
export class EventEmitter<M extends EventMap> {
  private readonly listeners = new Map<keyof M, Set<Listener<never>>>();
  private readonly onError: (error: unknown, event: keyof M) => void;

  constructor(onError?: (error: unknown, event: keyof M) => void) {
    this.onError =
      onError ??
      ((error, event) => {
        console.error(`[market-chart] listener for "${String(event)}" threw`, error);
      });
  }

  on<K extends keyof M>(event: K, listener: Listener<M[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.off(event, listener);
    };
  }

  once<K extends keyof M>(event: K, listener: Listener<M[K]>): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof M>(event: K, listener: Listener<M[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as Listener<never>);
    if (set.size === 0) this.listeners.delete(event);
  }

  hasListeners(event: keyof M): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<M[K]>)(payload);
      } catch (error) {
        this.onError(error, event);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
