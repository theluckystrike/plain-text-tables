import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PlainTextTablesPlugin from '../src/main';
import { DEFAULT_SETTINGS, effectiveOptions, normalizeSettings } from '../src/settings';
import { findTableBy, hiddenLines } from '../src/tables';
import manifest from '../manifest.json';
import { GROWTH_LIMIT, growth } from './growth';

describe('PlainTextTablesPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new PlainTextTablesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(DEFAULT_SETTINGS).toEqual({ enabled: true, align: false });
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ enabled: 'yes' as never, align: 1 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ enabled: false, align: true })).toEqual({ enabled: false, align: true });
	});

	it('turns the Pro options off without Pro and keeps the free option', () => {
		const s = { enabled: true, align: true };
		expect(effectiveOptions(s, false)).toEqual({ enabled: true, align: false });
		expect(effectiveOptions(s, true)).toEqual({ enabled: true, align: true });
		expect(effectiveOptions({ ...s, enabled: false }, false).enabled).toBe(false);
	});
});

describe('large notes', () => {
	it('finds a table at line 50,000 of a 100,000 line note fast', () => {
		const linesOf = (half: number) => {
			const lines: string[] = [];
			for (let i = 0; i < half; i++) lines.push(i % 100 === 0 ? '```' : `line ${i} | with a pipe`);
			lines.push('', '| a | b |', '|---|---|', '| 1 | 2 |', '');
			for (let i = 0; i < half; i++) lines.push(`tail ${i}`);
			return lines;
		};
		const find = (lines: string[], half: number) => {
			const hidden = hiddenLines(lines);
			return findTableBy((i) => lines[i]!, lines.length, half + 3, (i) => hidden[i]!);
		};
		expect(find(linesOf(50_000), 50_000)).toEqual({ start: 50_001, end: 50_003 });
		// Growth guard (s1101): 100,000 lines against 10,000 lines, timed in this test.
		const g = growth((half) => {
			const lines = linesOf(half);
			return () => find(lines, half);
		}, 50_000);
		expect(g.ratio, g.text).toBeLessThan(GROWTH_LIMIT);
	});

	it('does not scan a long run of pipe lines without a delimiter row more than once per line', () => {
		const lines = Array.from({ length: 20_000 }, (_, i) => `| row ${i} |`);
		expect(findTableBy((i) => lines[i]!, lines.length, 10_000, () => false)).toBeNull();
		// Growth guard (s1101): 20,000 pipe lines against 2,000, timed in this test. A rescan for each line is quadratic.
		const g = growth((n) => {
			const l = Array.from({ length: n }, (_, i) => `| row ${i} |`);
			return () => findTableBy((i) => l[i]!, l.length, n / 2, () => false);
		}, 20_000);
		expect(g.ratio, g.text).toBeLessThan(GROWTH_LIMIT);
	});
});
