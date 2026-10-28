import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PlainTextTablesPlugin from '../src/main';
import { DEFAULT_SETTINGS, effectiveOptions, normalizeSettings } from '../src/settings';
import { findTableBy, hiddenLines } from '../src/tables';
import manifest from '../manifest.json';

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
		const lines: string[] = [];
		for (let i = 0; i < 50_000; i++) lines.push(i % 100 === 0 ? '```' : `line ${i} | with a pipe`);
		lines.push('', '| a | b |', '|---|---|', '| 1 | 2 |', '');
		for (let i = 0; i < 50_000; i++) lines.push(`tail ${i}`);
		const t0 = performance.now();
		const hidden = hiddenLines(lines);
		const t = findTableBy((i) => lines[i]!, lines.length, 50_003, (i) => hidden[i]!);
		const ms = performance.now() - t0;
		expect(t).toEqual({ start: 50_001, end: 50_003 });
		// ESTIMATE of the budget: one pass over 100,000 short lines takes about 10 to 40 ms on a CI runner.
		expect(ms).toBeLessThan(1000);
	});

	it('does not scan a long run of pipe lines without a delimiter row more than once per line', () => {
		const lines = Array.from({ length: 20_000 }, (_, i) => `| row ${i} |`);
		const t0 = performance.now();
		expect(findTableBy((i) => lines[i]!, lines.length, 10_000, () => false)).toBeNull();
		expect(performance.now() - t0).toBeLessThan(1000);
	});
});
