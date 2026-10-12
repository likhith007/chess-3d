import { describe, expect, it } from 'vitest';
import { normalizeName, parseClientMessage } from '../../src/shared/protocol.ts';

describe('parseClientMessage', () => {
  it('parses join_queue', () => {
    expect(parseClientMessage('{"type":"join_queue"}')).toEqual({ type: 'join_queue' });
  });

  it('parses a move', () => {
    expect(parseClientMessage('{"type":"move","from":"e2","to":"e4"}')).toEqual({
      type: 'move',
      from: 'e2',
      to: 'e4',
    });
  });

  it('keeps a valid promotion piece', () => {
    expect(parseClientMessage('{"type":"move","from":"e7","to":"e8","promotion":"q"}')).toEqual({
      type: 'move',
      from: 'e7',
      to: 'e8',
      promotion: 'q',
    });
  });

  it('parses resign', () => {
    expect(parseClientMessage('{"type":"resign"}')).toEqual({ type: 'resign' });
  });

  it('parses hello with a trimmed name', () => {
    expect(parseClientMessage('{"type":"hello","name":"  Magnus  "}')).toEqual({
      type: 'hello',
      name: 'Magnus',
    });
  });

  it('parses hello with a session token', () => {
    const token = '3f2b8c1e-6d4a-4b7e-9c0f-1a2b3c4d5e6f';
    expect(parseClientMessage(JSON.stringify({ type: 'hello', name: 'Hikaru', token }))).toEqual({
      type: 'hello',
      name: 'Hikaru',
      token,
    });
  });

  it('parses a legal_moves request', () => {
    expect(parseClientMessage('{"type":"legal_moves","from":"g1"}')).toEqual({ type: 'legal_moves', from: 'g1' });
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['non-object', '42'],
    ['null', 'null'],
    ['unknown type', '{"type":"hack"}'],
    ['bad square', '{"type":"move","from":"z9","to":"e4"}'],
    ['missing to', '{"type":"move","from":"e2"}'],
    ['hello without name', '{"type":"hello"}'],
    ['hello with empty name', '{"type":"hello","name":"   "}'],
    ['hello with too-long name', JSON.stringify({ type: 'hello', name: 'x'.repeat(21) })],
    ['hello with markup in name', '{"type":"hello","name":"<script>"}'],
    ['hello with malformed token', '{"type":"hello","name":"ok","token":"abc"}'],
    ['legal_moves with bad square', '{"type":"legal_moves","from":"i9"}'],
    ['legal_moves without square', '{"type":"legal_moves"}'],
    ['bad promotion', '{"type":"move","from":"e7","to":"e8","promotion":"k"}'],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });
});

describe('normalizeName', () => {
  it('trims and accepts letters, digits, spaces and _ . -', () => {
    expect(normalizeName('  Magnus_C. 2-0 ')).toBe('Magnus_C. 2-0');
    expect(normalizeName('Ольга')).toBe('Ольга');
  });

  it.each([[''], ['   '], ['x'.repeat(21)], ['<b>hi</b>'], ['a@b']])('rejects %j', (name) => {
    expect(normalizeName(name)).toBeNull();
  });
});
