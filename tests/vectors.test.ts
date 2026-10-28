import { describe, expect, it } from 'vitest';
import vectors from './vectors/plain-text-tables.json';
import { alignTable, cellCursor, findTable, isDelimiterRow, splitRow } from '../src/tables';

const fns: Record<string, (...args: never[]) => unknown> = { findTable, splitRow, isDelimiterRow, cellCursor, alignTable };

describe('golden vectors (packages/spec/vectors/plain-text-tables.json)', () => {
	it('covers acceptance criteria A3, A5 and A8', () => {
		for (const n of ['A3', 'A5', 'A8']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(30);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[]))).toEqual(c.expected);
		});
	}
});
