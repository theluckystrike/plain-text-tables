import { describe, expect, it } from 'vitest';
import { plainTextTables, removeAll, shownIn } from '../src/editor';
import { ready, resetCore } from '../src/core';
import { drawnTables, findInput, mount, wait } from './harness';

const DOC = '# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntext line\n\n| c | d |\n|---|---|\n| 3 | 4 |\n';

describe('Find while the cursor is in a text table (model of core Find)', () => {
	it('keeps the table as text after each of 6 Find inputs, with no timer', async () => {
		let notices = 0;
		const { view } = mount(DOC, plainTextTables(() => ({ enabled: true, align: false }), () => notices++));
		await wait(120);
		expect(ready()).toBe(true);
		expect(drawnTables(view)).toBe(2);
		view.dispatch({ selection: { anchor: view.state.doc.line(5).from + 2 } });
		expect(shownIn(view)).not.toBeNull();
		expect(drawnTables(view)).toBe(1);
		const docBefore = view.state.doc.toString();
		for (let k = 1; k <= 6; k++) {
			// Each Find input removes every search mark first. The table must stay text in the same transaction.
			findInput(view, k % 2 ? [] : [{ from: 0, to: 1 }]);
			expect(drawnTables(view)).toBe(1);
		}
		// Esc: Find removes its marks once more.
		findInput(view, []);
		expect(drawnTables(view)).toBe(1);
		view.dispatch({ selection: { anchor: view.state.doc.line(5).from + 6 } });
		expect(drawnTables(view)).toBe(1);
		await wait(500);
		expect(drawnTables(view)).toBe(1);
		expect(view.state.doc.toString()).toBe(docBefore);
		expect(notices).toBe(0);
		removeAll();
		resetCore();
	});
});
