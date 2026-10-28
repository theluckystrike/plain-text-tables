import { browser, expect } from '@wdio/globals';
import { Key, type ChainablePromiseElement } from 'webdriverio';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';
import { alignTable } from '../../src/tables';

// Real-app checks for the acceptance criteria A1 to A7 and A10 of SPEC.md, on minAppVersion, on the latest app and
// on the latest app in mobile emulation (wdio.conf.mts). Keys are real key events (browser.keys).
const NOTE = [
	'# Prices', // 0
	'', // 1
	'| Item | Price |', // 2
	'|:-----|------:|', // 3
	'| Tea | 3 |', // 4
	'| Cake | 4.50 |', // 5
	'', // 6
	'Middle line.', // 7
	'', // 8
	'| Name | Role |', // 9
	'|---|---|', // 10
	'| Ana | Lead |', // 11
	'', // 12
	'```', // 13
	'| Code | Block |', // 14
	'|---|---|', // 15
	'```', // 16
	'', // 17
	'End line.', // 18
].join('\n');
const ACTIVE = '.workspace-leaf.mod-active';

interface View {
	widgets: number;
	textLines: number;
	mainFocus: boolean;
	cellFocus: boolean;
	line: number;
	ch: number;
	text: string;
}

/** The state of the active editor: drawn table widgets, text lines of a shown table, focus and cursor. */
async function view(): Promise<View> {
	return browser.executeObsidian(({ app }, sel) => {
		const root = document.querySelector(`${sel} .markdown-source-view`);
		const active = document.activeElement;
		const editor = app.workspace.activeEditor?.editor;
		const cur = editor?.getCursor() ?? { line: -1, ch: -1 };
		return {
			widgets: root ? root.querySelectorAll('.cm-table-widget').length : -1,
			textLines: root ? root.querySelectorAll('.cm-line.ptt-text-line').length : -1,
			mainFocus: !!active && active.classList.contains('cm-content') && !active.closest('.cm-table-widget') && !!root?.contains(active),
			cellFocus: !!active?.closest('.cm-table-widget'),
			line: cur.line,
			ch: cur.ch,
			text: editor?.getValue() ?? '',
		};
	}, ACTIVE);
}

/** Waits until check(view) is true. The error shows the last state. */
async function waitView(check: (v: View) => boolean, what: string, timeout = 5000): Promise<View> {
	let last: View | null = null;
	await browser
		.waitUntil(
			async () => {
				last = await view();
				return check(last);
			},
			{ timeout, interval: 100 },
		)
		.catch(async () => {
			const notices = await browser.executeObsidian(({ app }, sel) => {
				const seen = (window as unknown as { pttNotices?: string[] }).pttNotices ?? [];
				const cm = (app.workspace.activeEditor?.editor as unknown as { cm?: { posAtDOM(n: Node): number } } | undefined)?.cm;
				const widgets = Array.from(document.querySelectorAll(`${sel} .markdown-source-view .cm-table-widget`)).map((el) => {
					let pos = -1;
					try {
						pos = cm ? cm.posAtDOM(el) : -2;
					} catch {
						pos = -3;
					}
					return `${pos}:${el.getClientRects().length}`;
				});
				return { seen, now: Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? ''), widgets };
			}, ACTIVE);
			throw new Error(`${what}: ${JSON.stringify({ ...last, text: last?.text.slice(0, 400), notices })}`);
		});
	return last!;
}

/** Brings the app window to the front, so the editor can have the focus. */
async function focusWindow(): Promise<void> {
	await browser.execute(() => {
		try {
			const req = (window as unknown as { require: (m: string) => { app?: { focus(o?: unknown): void }; getCurrentWindow(): { focus(): void; show(): void } } }).require;
			const remote = req('@electron/remote');
			remote.app?.focus({ steal: true });
			remote.getCurrentWindow().show();
			remote.getCurrentWindow().focus();
		} catch {
			window.focus();
		}
	});
	await browser.waitUntil(async () => browser.execute(() => document.hasFocus()), { timeout: 5000, interval: 50, timeoutMsg: 'the app window has no focus' });
}

async function setMode(mode: 'source' | 'preview', source = false): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, m, s) => {
			const leaf = app.workspace.getMostRecentLeaf();
			if (!leaf) return;
			const st = leaf.getViewState();
			await leaf.setViewState({ ...st, state: { ...st.state, mode: m, source: s } });
		},
		mode,
		source,
	);
}

/** Writes the note, opens it in Live Preview and clicks the first line (a real click gives the editor the focus). */
async function openNote(path: string, text: string): Promise<void> {
	await obsidianPage.write(path, text);
	await browser.waitUntil(async () => browser.executeObsidian(async ({ app }, p, t) => {
		const f = app.vault.getFileByPath(p);
		return !!f && (await app.vault.cachedRead(f)) === t;
	}, path, text), { timeout: 10000, interval: 50, timeoutMsg: `${path} was not written` });
	await obsidianPage.openFile(path);
	await setMode('source', false);
	await focusWindow();
	await browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line`).click();
	await browser.keys([Key.Ctrl, Key.Home]);
}

/** A drawn table cell of the active editor whose text contains `text` (XPath: CSS has no text match). */
async function cell(text: string): Promise<ChainablePromiseElement> {
	return browser.$(`//div[contains(@class,"workspace-leaf") and contains(@class,"mod-active")]//div[contains(@class,"cm-table-widget")]//td[contains(normalize-space(.),"${text}")]`);
}

/** Types the rows with real keys, each on a new line, at the end of the active note. */
async function typeRows(rows: string[]): Promise<void> {
	await browser.keys([Key.Ctrl, Key.End]);
	await browser.keys([Key.Enter]);
	for (const row of rows) {
		await browser.keys([Key.Enter]);
		await browser.keys(row.split(''));
	}
}

async function setEnabled(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, v) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { enabled: boolean }; saveSettings(): Promise<void>; applySettings(): void }> } }).plugins.plugins[id]!;
		p.settings.enabled = v;
		await p.saveSettings();
		p.applySettings();
	}, pluginId, on);
}

describe('Plain Text Tables in Live Preview', function () {
	before(async function () {
		// Keep the text of each notice for failure messages (a notice can close before the test fails).
		await browser.execute(() => {
			const w = window as unknown as { pttNotices?: string[] };
			w.pttNotices = [];
			new MutationObserver((list) => {
				for (const m of list) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement && n.classList.contains('notice')) w.pttNotices!.push(n.textContent ?? '');
			}).observe(document.body, { childList: true, subtree: true });
		});
		await setEnabled(true);
	});

	it('A1 A2 arrow keys into a table show its text, and out of it draw it again', async function () {
		await openNote('Tables.md', NOTE);
		await waitView((v) => v.widgets === 2 && v.textLines === 0 && v.line === 0, 'two tables drawn at the start');
		await browser.keys([Key.ArrowDown]);
		await browser.keys([Key.ArrowDown]);
		const inTable = await waitView((v) => v.textLines === 4 && v.widgets === 1, 'the first table is not text after two Down keys');
		expect(inTable.line).toBe(2);
		expect(inTable.mainFocus).toBe(true);
		expect(inTable.cellFocus).toBe(false);
		await browser.keys([Key.ArrowDown, Key.ArrowDown, Key.ArrowDown]);
		const last = await view();
		expect(last.line).toBe(5);
		expect(last.textLines).toBe(4);
		await browser.keys([Key.ArrowDown]);
		const out = await waitView((v) => v.widgets === 2 && v.textLines === 0, 'the table is not drawn again after the cursor left');
		expect(out.line).toBe(6);
		expect(out.mainFocus).toBe(true);
		// Up again from below enters the table at its last row.
		await browser.keys([Key.ArrowUp]);
		const back = await waitView((v) => v.textLines === 4, 'Up from below does not show the table text');
		expect(back.line).toBe(5);
		expect(back.mainFocus).toBe(true);
	});

	it('A3 a click on a cell shows the text with the cursor at the end of that cell', async function () {
		await openNote('Tables.md', NOTE);
		await waitView((v) => v.widgets === 2, 'two tables drawn');
		await (await cell('Cake')).click();
		const v = await waitView((x) => x.textLines === 4 && x.line === 5, 'a click on the Cake cell does not show the text');
		expect(v.ch).toBe('| Cake'.length);
		expect(v.mainFocus).toBe(true);
		expect(v.widgets).toBe(1);
		// Scroll: the clicked row is in the visible part of the editor.
		const visible = await browser.execute((sel: string) => {
			const scroller = document.querySelector(`${sel} .markdown-source-view .cm-scroller`);
			const line = Array.from(document.querySelectorAll(`${sel} .cm-line.ptt-text-line`)).find((l) => (l.textContent ?? '').includes('Cake'));
			if (!scroller || !line) return false;
			const a = scroller.getBoundingClientRect();
			const b = line.getBoundingClientRect();
			return b.top >= a.top && b.bottom <= a.bottom;
		}, ACTIVE);
		expect(visible).toBe(true);
	});

	it('A4 typing in the text table changes the note and keeps the table as text', async function () {
		await openNote('Tables.md', NOTE);
		await waitView((v) => v.widgets === 2, 'two tables drawn');
		await (await cell('Cake')).click();
		await waitView((v) => v.textLines === 4 && v.line === 5, 'no text table after the click');
		await browser.keys(['s']);
		await browser.keys([Key.End, Key.Enter]);
		await browser.keys('| Pie | 5 |'.split(''));
		const v = await waitView((x) => x.text.includes('Pie | 5'), 'the typed row is not in the note');
		const lines = v.text.split('\n');
		expect(lines[5]).toBe('| Cakes | 4.50 |');
		expect(lines.some((l) => l.includes('| Pie | 5 |'))).toBe(true);
		expect(v.textLines).toBeGreaterThanOrEqual(5);
		expect(v.widgets).toBe(1);
		expect(v.mainFocus).toBe(true);
		// Leave by a click on the last line: both tables are drawn.
		await browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line:last-child`).click();
		await waitView((x) => x.widgets === 2 && x.textLines === 0, 'the tables are not drawn after the click on the last line');
	});

	it('A4 a new table typed in Live Preview gives the same text as in Source mode and stays text', async function () {
		const rows = ['| a | b |', '|---|---|', '| 1 | 2 |'];
		// Obsidian itself pads the cells of table text while you type. Source mode is the reference.
		await openNote('NewSource.md', 'Start.\n');
		await setMode('source', true);
		await browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line`).click();
		await typeRows(rows);
		const source = await waitView((x) => x.text.includes('| 1 |'), 'the typed table is not in the Source mode note');
		await openNote('New.md', 'Start.\n');
		await typeRows(rows);
		const v = await waitView((x) => x.text.includes('| 1 |'), 'the typed table is not in the note');
		expect(v.text).toBe(source.text);
		expect(v.textLines).toBe(3);
		expect(v.widgets).toBe(0);
		expect(v.mainFocus).toBe(true);
		// Leave the table: Obsidian draws it.
		await browser.keys([Key.Ctrl, Key.Home]);
		await waitView((x) => x.widgets === 1 && x.textLines === 0, 'the new table is not drawn after the cursor left');
	});

	it('A5 A10 a table in a code block is not changed', async function () {
		await openNote('Tables.md', NOTE);
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setCursor({ line: 14, ch: 3 });
		});
		await browser.pause(300);
		const v = await view();
		expect(v.line).toBe(14);
		expect(v.textLines).toBe(0);
		expect(v.widgets).toBe(2);
	});

	it('A6 Source mode and Reading view do not change', async function () {
		await openNote('Tables.md', NOTE);
		await setMode('source', true);
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setCursor({ line: 4, ch: 2 });
		});
		await browser.pause(300);
		const src = await view();
		expect(src.widgets).toBe(0);
		expect(src.textLines).toBe(0);
		await setMode('preview');
		// Reading view renders after the mode switch; wait for it.
		await browser.waitUntil(async () => (await browser.execute((sel: string) => document.querySelectorAll(`${sel} .markdown-reading-view table`).length, ACTIVE)) === 2, { timeout: 5000, interval: 100, timeoutMsg: 'Reading view does not show the 2 tables' });
		await setMode('source', false);
	});

	it('A7 the command and the setting draw the table again at once', async function () {
		await openNote('Tables.md', NOTE);
		await browser.keys([Key.ArrowDown, Key.ArrowDown]);
		await waitView((v) => v.textLines === 4, 'no text table');
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(`${id}:toggle-table-text`);
		}, pluginId);
		await waitView((v) => v.widgets === 2 && v.textLines === 0, 'the command did not draw the table again');
		await setEnabled(true);
		await openNote('Tables.md', NOTE);
		await browser.keys([Key.ArrowDown, Key.ArrowDown]);
		await waitView((v) => v.textLines === 4, 'no text table after the command turned it on again');
	});

	it('A7 A10 turning the plugin off while a table is text draws it again', async function () {
		await openNote('Tables.md', NOTE);
		await browser.keys([Key.ArrowDown, Key.ArrowDown]);
		await waitView((v) => v.textLines === 4 && v.widgets === 1, 'no text table');
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
		}, pluginId);
		try {
			await waitView((v) => v.widgets === 2 && v.textLines === 0, 'the table is still text after the plugin was turned off');
		} finally {
			await browser.executeObsidian(async ({ app }, id) => {
				await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id);
			}, pluginId);
		}
		await openNote('Tables.md', NOTE);
		await browser.keys([Key.ArrowDown, Key.ArrowDown]);
		await waitView((v) => v.textLines === 4, 'no text table after the plugin was turned on again');
	});

	it('A10 a 5,000 line note: entry and 200 edits in a table stay fast', async function () {
		const big: string[] = [];
		for (let i = 0; i < 2500; i++) big.push(`Line ${i} with some text and a [[link]].`);
		big.push('', '| Big | Table |', '|---|---|', '| x | y |', '');
		for (let i = 0; i < 2500; i++) big.push(`Tail ${i} more text.`);
		await openNote('Big.md', big.join('\n'));
		const times = await browser.executeObsidian(async ({ app }) => {
			const editor = app.workspace.activeEditor!.editor!;
			editor.focus();
			const t0 = performance.now();
			editor.setCursor({ line: 2503, ch: 3 });
			const entry = performance.now() - t0;
			await new Promise((r) => setTimeout(r, 200));
			const t1 = performance.now();
			for (let i = 0; i < 200; i++) editor.replaceRange('z', { line: 2503, ch: 3 });
			const edits = performance.now() - t1;
			return { entry, edits, row: editor.getLine(2503).length };
		});
		expect(times.row).toBe('| x | y |'.length + 200);
		// ESTIMATE of the budget: 200 edits of a plain CodeMirror line take about 100 to 300 ms on a CI runner.
		expect(times.edits).toBeLessThan(3000);
		expect(times.entry).toBeLessThan(500);
		const v = await view();
		expect(v.textLines).toBe(3);
	});
	it('A10 the table stays text while Find runs and after Escape, keys then type at the caret, and a second pane of the note keeps its table drawn', async function () {
		await openNote('Tables.md', NOTE);
		await browser.keys([Key.ArrowDown, Key.ArrowDown]);
		await waitView((v) => v.textLines === 4 && v.widgets === 1, 'no text table');
		// Find removes every search mark on each search input and when it closes, also the mark of the plugin.
		// Real Find: open it, type 6 characters with no match, close it with Escape.
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setCursor({ line: 4, ch: 5 });
			(app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById('editor:open-search');
		});
		await browser.waitUntil(async () => browser.execute(() => document.activeElement?.tagName === 'INPUT'), { timeout: 5000, interval: 100, timeoutMsg: 'Find did not open (no focused input)' });
		await browser.keys('qzqzqz'.split(''));
		const during = await view();
		expect(during.textLines).toBe(4);
		expect(during.widgets).toBe(1);
		await browser.keys([Key.Escape]);
		await browser.pause(300);
		const after = await waitView((v) => v.textLines === 4 && v.widgets === 1, 'the table is drawn while the cursor is in it after Find closed').catch(async (e: Error) => {
			const diag = await browser.executeObsidian(({ app }) => {
				const cm = (app.workspace.activeEditor?.editor as unknown as { cm: { posAtDOM(n: Node): number; state: { selection: { main: { head: number } } } } }).cm;
				const root = document.querySelector('.workspace-leaf.mod-active .markdown-source-view');
				const widgets = Array.from(root?.querySelectorAll('.cm-table-widget') ?? []).map((el) => {
					try {
						return cm.posAtDOM(el);
					} catch {
						return -1;
					}
				});
				return { widgets, head: cm.state.selection.main.head, mobile: (app as unknown as { isMobile: boolean }).isMobile };
			});
			throw new Error(`${e.message} ${JSON.stringify(diag)}`);
		});
		expect(after.mainFocus).toBe(true);
		expect(after.line).toBe(4);
		expect(after.ch).toBe(5);
		await browser.keys(['W']);
		const typed = await waitView((v) => v.text.split('\n')[4] === '| TeaW | 3 |', 'a key after Find did not go into the table text at the caret');
		expect(typed.line).toBe(4);
		expect(typed.ch).toBe(6);
		expect(typed.textLines).toBe(4);
		expect(typed.widgets).toBe(1);
		expect(typed.text.split('\n').filter((l, i) => i !== 4).join('\n')).toBe(NOTE.split('\n').filter((l, i) => i !== 4).join('\n'));
		await browser.keys([Key.Ctrl, Key.Home]);
		await waitView((v) => v.textLines === 0 && v.widgets === 2, 'the tables are not drawn after Ctrl Home');
		// A second pane of the same note: the cursor in a table of one pane does not change the other pane.
		const counts = await browser.executeObsidian(async ({ app }) => {
			const first = app.workspace.getMostRecentLeaf()!;
			const leaf = app.workspace.getLeaf('split');
			await leaf.openFile(app.vault.getFileByPath('Tables.md')!);
			const st = leaf.getViewState();
			await leaf.setViewState({ ...st, state: { ...st.state, mode: 'source', source: false } });
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const ed = (leaf.view as unknown as { editor: { focus(): void; setCursor(p: { line: number; ch: number }): void } }).editor;
			ed.focus();
			ed.setCursor({ line: 0, ch: 0 });
			ed.setCursor({ line: 4, ch: 2 });
			await new Promise((r) => setTimeout(r, 400));
			const count = (l: typeof first, sel: string) => l.view.containerEl.querySelectorAll(sel).length;
			const res = { leftText: count(first, '.cm-line.ptt-text-line'), leftWidgets: count(first, '.cm-table-widget'), rightText: count(leaf, '.cm-line.ptt-text-line'), rightWidgets: count(leaf, '.cm-table-widget') };
			leaf.detach();
			return res;
		});
		expect(counts).toEqual({ leftText: 0, leftWidgets: 2, rightText: 4, rightWidgets: 1 });
	});

	it('A8 Pro aligns a changed table when the cursor leaves it, in one undo step, and the command aligns at the cursor', async function () {
		const ok = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: unknown; settings: { align: boolean }; applySettings(): void }> } }).plugins.plugins[id]!;
			const manager = p.pro as { opts: { http: unknown }; refreshNow(): Promise<unknown>; isPro(): boolean };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await manager.refreshNow();
			p.settings.align = true;
			p.applySettings();
			return manager.isPro();
		}, pluginId);
		expect(ok).toBe(true);
		try {
			await openNote('Tables.md', NOTE);
			await waitView((v) => v.widgets === 2, 'two tables drawn');
			await (await cell('Tea')).click();
			await waitView((v) => v.textLines === 4 && v.line === 4, 'no text table after the click on Tea');
			await browser.keys(['x', 'x']);
			const edited = await waitView((x) => x.text.includes('Teaxx'), 'the typed text is not in the note');
			const before = edited.text.split('\n').slice(2, 6);
			const aligned = alignTable(before);
			expect(aligned).not.toEqual(before);
			await browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line:last-child`).click();
			const v = await waitView((x) => x.text.split('\n').slice(2, 6).join('\n') === aligned.join('\n'), 'the table is not aligned after the cursor left');
			expect(v.widgets).toBe(2);
			await browser.keys([Key.Ctrl, 'z']);
			await waitView((x) => x.text.split('\n').slice(2, 6).join('\n') === before.join('\n'), 'one undo does not remove the alignment only');
			// A table that did not change is not aligned when the cursor leaves it. A new note: the editor of
			// Tables.md can still save the undo text.
			await openNote('Unchanged.md', NOTE);
			await (await cell('Ana')).click();
			await waitView((x) => x.line === 11 && x.textLines === 3, 'no text table after the click on Ana');
			await browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line:last-child`).click();
			await browser.pause(500);
			expect((await view()).text).toBe(NOTE);
			// The Pro command aligns the table at the cursor.
			await browser.executeObsidian(({ app }, id) => {
				app.workspace.activeEditor?.editor?.setCursor({ line: 4, ch: 2 });
				(app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(`${id}:align-table`);
			}, pluginId);
			const want = alignTable(NOTE.split('\n').slice(2, 6));
			await waitView((x) => x.text.split('\n').slice(2, 6).join('\n') === want.join('\n'), 'the command did not align the table');
		} finally {
			await browser.executeObsidian(({ app }, id) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } | null; settings: { align: boolean }; saveSettings(): Promise<void>; applySettings(): void }> } }).plugins.plugins[id]!;
				p.pro?.signOut();
				p.settings.align = false;
				void p.saveSettings();
				p.applySettings();
			}, pluginId);
		}
	});

	it('A9 a free user who runs the align command gets the Pro notice and the table does not change', async function () {
		await openNote('Tables.md', NOTE);
		await browser.executeObsidian(({ app }, id) => {
			document.querySelectorAll('.notice').forEach((n) => n.remove());
			app.workspace.activeEditor?.editor?.setCursor({ line: 4, ch: 2 });
			(app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(`${id}:align-table`);
		}, pluginId);
		await browser.waitUntil(async () => browser.execute(() => Array.from(document.querySelectorAll('.notice')).some((n) => (n.textContent ?? '').includes('Align the current table is a Pro feature.') && n.querySelectorAll('.pf-pro-notice-sponsor').length === 1)), { timeout: 5000, timeoutMsg: 'no Pro notice with a Sponsor button after the command' });
		expect((await view()).text).toBe(NOTE);
	});
});
