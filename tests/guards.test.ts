import { describe, expect, it } from 'vitest';
import { plainTextTables, removeAll } from '../src/editor';
import { ready, resetCore } from '../src/core';
import { TableWidget, mount, wait } from './harness';

const DOC = '# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntext\n';

describe('guards of the table widget wrap', () => {
	it('unload keeps a wrap that another plugin added after this plugin', async () => {
		const proto = TableWidget.prototype as unknown as Record<string, unknown>;
		const original = proto.receiveSelection;
		const { view } = mount(DOC, plainTextTables(() => ({ enabled: true, align: false }), () => undefined));
		await wait(120);
		expect(ready()).toBe(true);
		const ours = proto.receiveSelection as (...a: unknown[]) => unknown;
		const other = function (this: unknown, ...a: unknown[]): unknown {
			return ours.apply(this, a);
		};
		proto.receiveSelection = other;
		removeAll();
		resetCore();
		expect(proto.receiveSelection).toBe(other);
		expect(proto.receiveUpdate).not.toBe(undefined);
		proto.receiveSelection = original;
		view.destroy();
	});

	it('a widget class without an update method is unsupported: 1 notice, nothing wrapped', async () => {
		const proto = TableWidget.prototype as unknown as Record<string, unknown>;
		const update = proto.receiveUpdate;
		const receive = proto.receiveSelection;
		delete proto.receiveUpdate;
		let notices = 0;
		try {
			const { view } = mount(DOC, plainTextTables(() => ({ enabled: true, align: false }), () => notices++));
			await wait(120);
			view.dispatch({ selection: { anchor: view.state.doc.line(5).from + 2 } });
			await wait(50);
			expect(ready()).toBe(false);
			expect(notices).toBe(1);
			expect(proto.receiveSelection).toBe(receive);
			removeAll();
			resetCore();
		} finally {
			proto.receiveUpdate = update;
		}
	});
});
