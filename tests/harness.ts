// Test harness (first written by reviewer R-NEW): a small model of the Obsidian 1.14.5 parts that core.ts uses.
// - core highlight field with a filter effect and an add effect, and editor.addHighlights (app.js: addHighlights)
// - Live Preview table widget: a block replace widget per table, skipped when a mark of the shared
//   "obsidian-search-match-highlight" decoration touches the table range (app.js buildDeco: ly(m, y, e, t))
// - Find: addHighlights(matches, cls, true) removes all marks of the class first (app.js: highlight())
import { EditorState, type Range, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { editorEditorField, editorInfoField, editorLivePreviewField } from 'obsidian';
import { findTable } from '../src/tables';

export const MATCH = 'obsidian-search-match-highlight';
type Keep = (from: number, to: number, value: Decoration) => boolean;
export const coreFilter = StateEffect.define<Keep>();
export const coreAdd = StateEffect.define<Range<Decoration>[]>();
const cache = new Map<string, Decoration>();
export function markOf(cls: string): Decoration {
	let m = cache.get(cls);
	if (!m) {
		m = Decoration.mark({ class: cls });
		cache.set(cls, m);
	}
	return m;
}

export const coreField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		value = value.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(coreFilter)) value = value.update({ filter: e.value });
			if (e.is(coreAdd)) value = value.update({ add: e.value, sort: true });
		}
		return value;
	},
	provide: (f) => EditorView.decorations.from(f),
});

export const receiveCalls: number[] = [];
/** Model of a later Obsidian whose Live Preview no longer skips the widget for the search mark. */
export const model = { ignoreMarks: false };

export class TableWidget extends WidgetType {
	constructor(
		readonly start: number,
		readonly text: string,
	) {
		super();
	}
	eq(o: TableWidget): boolean {
		return o.start === this.start && o.text === this.text;
	}
	toDOM(): HTMLElement {
		const d = document.createElement('div');
		d.className = 'cm-table-widget';
		const t = d.appendChild(document.createElement('table'));
		for (const line of this.text.split('\n').filter((_, i) => i !== 1)) {
			const tr = t.appendChild(document.createElement('tr'));
			for (const c of line.split('|').slice(1, -1)) tr.appendChild(document.createElement('td')).textContent = c.trim();
		}
		return d;
	}
}
// Own methods on the prototype, as the core class has them.
(TableWidget.prototype as unknown as Record<string, unknown>).receiveSelection = function (this: TableWidget): void {
	receiveCalls.push(this.start);
};
(TableWidget.prototype as unknown as Record<string, unknown>).containsSelection = function (): boolean {
	return false;
};
(TableWidget.prototype as unknown as Record<string, unknown>).receiveUpdate = function (): boolean {
	return true;
};

function tables(state: EditorState): DecorationSet {
	const lines = state.doc.toString().split('\n');
	const marks = state.field(coreField);
	const shared = cache.get(MATCH);
	const out: Range<Decoration>[] = [];
	for (let i = 0; i < lines.length; i++) {
		const t = findTable(lines, i);
		if (!t || t.start !== i) continue;
		const from = state.doc.line(t.start + 1).from;
		const to = state.doc.line(t.end + 1).to;
		let touched = false;
		if (shared && !model.ignoreMarks) marks.between(from, to, (f, tt, v) => {
			if (v === shared && f <= to && tt >= from) touched = true;
		});
		if (!touched) out.push(Decoration.replace({ widget: new TableWidget(from, state.doc.sliceString(from, to)), block: true }).range(from, to));
		i = t.end;
	}
	return RangeSet.of(out);
}

export const lpTables = StateField.define<DecorationSet>({
	create: (s) => tables(s),
	update: (_v, tr) => tables(tr.state),
	provide: (f) => EditorView.decorations.from(f),
});

export interface FakeEditor {
	addHighlights?: (ranges: { from: { line: number; ch: number }; to: { line: number; ch: number } }[], cls: string, removePrevious?: boolean) => void;
}

export function makeEditor(holder: { view?: EditorView }, withHighlights: boolean): FakeEditor {
	if (!withHighlights) return {};
	return {
		addHighlights(ranges, cls, removePrevious) {
			const view = holder.view!;
			const doc = view.state.doc;
			const m = markOf(cls);
			const pos = (p: { line: number; ch: number }): number => doc.line(p.line + 1).from + p.ch;
			const effects: StateEffect<unknown>[] = [];
			if (removePrevious) effects.push(coreFilter.of((_f, _t, v) => v !== m));
			effects.push(coreAdd.of(ranges.map((r) => m.range(pos(r.from), pos(r.to)))));
			view.dispatch({ effects });
		},
	};
}

export function mount(doc: string, ext: Extension, withHighlights = true): { view: EditorView; editor: FakeEditor } {
	const holder: { view?: EditorView } = {};
	const editor = makeEditor(holder, withHighlights);
	const state = EditorState.create({
		doc,
		extensions: [editorLivePreviewField.init(() => true), editorInfoField.init(() => ({ editor }) as never), coreField, lpTables, ext],
	});
	const parent = document.createElement('div');
	document.body.appendChild(parent);
	const view = new EditorView({ state, parent });
	holder.view = view;
	// Obsidian has editorEditorField on every Markdown editor state.
	view.dispatch({ effects: StateEffect.appendConfig.of(editorEditorField.init(() => view)) });
	return { view, editor };
}

/** What Find does on each search input: addHighlights(matches, MATCH, true). */
export function findInput(view: EditorView, matches: { from: number; to: number }[]): void {
	const m = markOf(MATCH);
	view.dispatch({ effects: [coreFilter.of((_f, _t, v) => v !== m), coreAdd.of(matches.map((r) => m.range(r.from, r.to)))] });
}

export function drawnTables(view: EditorView): number {
	let n = 0;
	view.state.field(lpTables).between(0, view.state.doc.length, () => {
		n++;
	});
	return n;
}

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
