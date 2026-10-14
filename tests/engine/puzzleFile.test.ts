import { describe, expect, it } from 'vitest';
import { parsePuzzleFile, serializePuzzle } from '../../src/engine/puzzleFile';
import { normalizePuzzle } from '../../src/engine/puzzle';
import { board, dom } from './fixtures';

const sample = normalizePuzzle(
  board(
    ['##.#', '####'],
    [
      { cells: ['0,0', '1,0'], constraint: { type: 'sum', target: 11 } },
      { cells: ['0,1', '1,1'], constraint: { type: 'neq' } },
      { cells: ['1,2'], constraint: { type: 'lt', target: 4 } },
      { cells: ['0,3', '1,3'], constraint: null },
    ],
    [dom('d1', 1, 2), dom('d2', 3, 4), dom('d3', 6, 6), dom('d4', 4, 6)],
  ),
);

describe('puzzle files', () => {
  it('round-trips a puzzle through JSON', () => {
    const back = parsePuzzleFile(serializePuzzle(sample));
    expect(back).toEqual(sample);
    expect(back.id).toBe(sample.id);
  });

  it('writes a readable format', () => {
    const f = JSON.parse(serializePuzzle(sample));
    expect(f.format).toBe('pips-build-puzzle');
    expect(f.regions.map((r: { condition: string | null }) => r.condition)).toEqual(['11', '≠', '<4', null]);
    expect(f.dominoes).toEqual([[1, 2], [3, 4], [6, 6], [4, 6]]);
  });

  it('still imports files saved under the old app name', () => {
    const f = JSON.parse(serializePuzzle(sample));
    expect(parsePuzzleFile(JSON.stringify({ ...f, format: 'pip-studio-puzzle' }))).toEqual(sample);
  });

  it('rejects files that are not puzzles', () => {
    expect(() => parsePuzzleFile('not json')).toThrow('not valid JSON');
    expect(() => parsePuzzleFile('{"hello":1}')).toThrow('not a Pips Build puzzle');
  });

  it('rejects invalid contents with a clear message', () => {
    const f = JSON.parse(serializePuzzle(sample));
    expect(() => parsePuzzleFile(JSON.stringify({ ...f, dominoes: [[1, 9]] }))).toThrow('pip counts from 0 to 6');
    expect(() => parsePuzzleFile(JSON.stringify({ ...f, regions: [{ color: 0, cells: ['9,9'], condition: null }] }))).toThrow(
      'not on the board',
    );
    expect(() => parsePuzzleFile(JSON.stringify({ ...f, regions: [{ color: 0, cells: ['0,0'], condition: 'abc' }] }))).toThrow(
      'Unknown condition',
    );
  });
});
