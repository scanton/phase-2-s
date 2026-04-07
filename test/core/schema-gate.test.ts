import { describe, it, expect, vi } from 'vitest';
import { schemaGate } from '../../src/core/schema-gate.js';

function isString(x: unknown): x is string {
  return typeof x === 'string';
}

interface Point { x: number; y: number }
function isPoint(x: unknown): x is Point {
  return typeof x === 'object' && x !== null &&
    typeof (x as Point).x === 'number' &&
    typeof (x as Point).y === 'number';
}

describe('schemaGate', () => {
  it('valid output on first attempt — no retry', async () => {
    const fn = vi.fn().mockResolvedValueOnce('{"x":1,"y":2}');
    const result = await schemaGate(fn, isPoint);
    expect(result).toEqual({ x: 1, y: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(undefined);
  });

  it('invalid first → valid second (one retry)', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce('{"x":3,"y":4}');
    const result = await schemaGate(fn, isPoint);
    expect(result).toEqual({ x: 3, y: 4 });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(2, expect.stringContaining('JSON parse error'));
  });

  it('max retries exceeded → throws', async () => {
    const fn = vi.fn().mockResolvedValue('bad');
    await expect(schemaGate(fn, isPoint, 2)).rejects.toThrow('schemaGate: max retries');
    expect(fn).toHaveBeenCalledTimes(3);  // initial + 2 retries
  });

  it('raw error string propagated as retryContext on second call', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce('"just-a-string"')  // valid JSON but wrong type
      .mockResolvedValueOnce('{"x":0,"y":0}');
    await schemaGate(fn, isPoint);
    // Second call receives the validation failure message
    const secondArg = fn.mock.calls[1][0] as string;
    expect(secondArg).toContain('Validation failed');
    expect(secondArg).toContain('just-a-string');
  });

  it('non-JSON output → retry with parse error context', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce('this is not json {{{')
      .mockResolvedValueOnce('{"x":5,"y":6}');
    const result = await schemaGate(fn, isPoint);
    expect(result).toEqual({ x: 5, y: 6 });
    const retryArg = fn.mock.calls[1][0] as string;
    expect(retryArg).toContain('JSON parse error');
  });

  it('fn() throws (network/provider error) → propagates immediately', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network timeout'));
    await expect(schemaGate(fn, isPoint)).rejects.toThrow('network timeout');
    expect(fn).toHaveBeenCalledTimes(1);  // no retry on throw
  });

  it('retries=0 → throws immediately on first invalid output', async () => {
    const fn = vi.fn().mockResolvedValue('"string"');
    await expect(schemaGate(fn, isPoint, 0)).rejects.toThrow('schemaGate: max retries (0) exceeded');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
