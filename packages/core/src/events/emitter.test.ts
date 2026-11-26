import { describe, expect, it } from 'vitest';
import { EventEmitter } from './emitter.js';

interface Events {
  a: number;
  b: string;
}

describe('EventEmitter', () => {
  it('delivers typed payloads and unsubscribes', () => {
    const emitter = new EventEmitter<Events>();
    const received: number[] = [];
    const off = emitter.on('a', (v) => received.push(v));
    emitter.emit('a', 1);
    off();
    off();
    emitter.emit('a', 2);
    expect(received).toEqual([1]);
    expect(emitter.hasListeners('a')).toBe(false);
  });

  it('isolates throwing listeners', () => {
    const errors: unknown[] = [];
    const emitter = new EventEmitter<Events>((error) => errors.push(error));
    const received: string[] = [];
    emitter.on('b', () => {
      throw new Error('boom');
    });
    emitter.on('b', (v) => received.push(v));
    emitter.emit('b', 'x');
    expect(received).toEqual(['x']);
    expect(errors).toHaveLength(1);
  });

  it('supports once and unsubscribing during emit', () => {
    const emitter = new EventEmitter<Events>();
    const calls: string[] = [];
    emitter.once('a', () => calls.push('once'));
    const off = emitter.on('a', () => {
      calls.push('self');
      off();
    });
    emitter.on('a', () => calls.push('other'));
    emitter.emit('a', 1);
    emitter.emit('a', 2);
    expect(calls).toEqual(['once', 'self', 'other', 'other']);
  });
});
