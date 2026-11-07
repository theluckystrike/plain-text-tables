import { describe, expect, it } from 'vitest';
import { plainTextTables, removeAll, shownIn } from '../src/editor';
import { failed, ready, resetCore } from '../src/core';
import { TableWidget, drawnTables, model, mount, until, wait } from './harness';

const DOC = '# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntext\n';

describe('fail safe: a Live Preview that draws the table in spite of the mark (later Obsidian)', () => {
	it('shows 1 notice, restores the methods of Obsidian and stops for the session', async () => {
		const proto = TableWidget.prototype as unknown as Record<string, unknown>;
		const originals = { receiveSelection: proto.receiveSelection, receiveUpdate: proto.receiveUpdate };
		model.ignoreMarks = true;
		let notices = 0;
		const { view } = mount(DOC, plainTextTables(() => ({ enabled: true, align: false }), () => notices++));
		await wait(120);
		expect(ready()).toBe(true);
		expect(proto.receiveSelection).not.toBe(originals.receiveSelection);
		view.dispatch({ selection: { anchor: view.state.doc.line(5).from + 2 } });
		// The fail safe needs a 50 ms and then a 300 ms timer (src/editor.ts scheduleCheck). A fixed wait(800) left 450 ms
		// for event loop lag: 30.7 ms here under load, about 645 ms on a CI runner at 21 times (s1104 R-CI-B). Poll for
		// the fail safe instead, with a 10 s deadline.
		expect(await until(() => failed())).toBe(true);
		expect(notices).toBe(1);
		expect(failed()).toBe(true);
		expect(ready()).toBe(false);
		expect(proto.receiveSelection).toBe(originals.receiveSelection);
		expect(proto.receiveUpdate).toBe(originals.receiveUpdate);
		expect(shownIn(view)).toBeNull();
		expect(drawnTables(view)).toBe(1);
		// More moves in and out: no second notice, no text table.
		for (const line of [1, 5, 4, 7, 5]) {
			view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
			await wait(20);
		}
		await wait(500);
		expect(notices).toBe(1);
		expect(shownIn(view)).toBeNull();
		model.ignoreMarks = false;
		removeAll();
		resetCore();
	});
});
