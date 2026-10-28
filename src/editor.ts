// The editor part: while the main cursor is in a Markdown table in Live Preview, a core search highlight on the line
// break after the header row makes Live Preview show the table as text lines (core.ts). The highlight is added and
// removed in the same transaction that moves the cursor, so the table widget never takes the focus.
import { isolateHistory } from '@codemirror/commands';
import { Annotation, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension, type Text, type Transaction } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { Platform, editorEditorField, editorInfoField, editorLivePreviewField } from 'obsidian';
import { capture, coreHighlights, failSafe, failed, patchWidget, ready } from './core';
import { alignTable, cellCursor, findTableBy, hiddenLines, type TableLines } from './tables';

/** What the editor part reads from the plugin on each use. */
export interface EditorOptions {
	/** Rule 1: show the table text while the cursor is in the table. */
	enabled: boolean;
	/** Pro P1: align the columns when the cursor leaves a changed table. */
	align: boolean;
}

/** The table that the plugin shows as text in this editor. Positions are in the current document. */
export interface Shown {
	/** Start of the header line. */
	from: number;
	/** End of the last row line. */
	to: number;
	/** Position of the line break after the header row: the core mark covers [anchor, anchor + 1]. */
	anchor: number;
	/** The table text when the cursor came in. P1 aligns only a table that changed. */
	base: string;
}

const setShown = StateEffect.define<Shown | null>();

/** The shown table, mapped through each change. The transaction extender sets a new value when the table changes. */
export const shownField = StateField.define<Shown | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setShown)) return e.value;
		if (!value || !tr.docChanged) return value;
		return { ...value, from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1), anchor: tr.changes.mapPos(value.anchor, 1) };
	},
});

/**
 * The table at 1-based line `lineNo` of doc, as positions. With checkHidden, a table in a code fence, a math block or
 * the front matter is not a table. That check reads the lines above the table, so it runs only after the cheap check
 * found a table.
 */
function tableAt(doc: Text, lineNo: number, checkHidden: boolean): { from: number; to: number; anchor: number; lines: TableLines } | null {
	const get = (i: number): string => doc.line(i + 1).text;
	const t = findTableBy(get, doc.lines, lineNo - 1, () => false);
	if (!t) return null;
	if (checkHidden) {
		// A run of row lines has no fence line in it, so the header line decides for the whole table.
		const above: string[] = [];
		for (let i = 0; i <= t.start; i++) above.push(get(i));
		if (hiddenLines(above)[t.start]) return null;
	}
	const head = doc.line(t.start + 1);
	const last = doc.line(t.end + 1);
	return { from: head.from, to: last.to, anchor: head.to, lines: t };
}

/** True when the cursor position is in the shown table, from the start of the header to the end of the last row. */
function inside(s: Shown, pos: number): boolean {
	return pos >= s.from && pos <= s.to;
}

/** Text of the table rows from the header to the last row. */
function tableText(doc: Text, s: { from: number; to: number }): string {
	return doc.sliceString(s.from, s.to);
}

let warned = false;
/** The callback that shows the one notice, from the last plainTextTables() call. */
let notifyUnsupported: ((drawn: boolean) => void) | null = null;

/** Shows the notice that the plugin cannot show table text, once per session. drawn: Obsidian drew the table. */
function warnOnce(drawn = false): void {
	if (warned) return;
	warned = true;
	notifyUnsupported?.(drawn);
}

/** Marks the transactions that this plugin dispatches itself. Their core filter effects are the plugin's own. */
const own = Annotation.define<boolean>();

/**
 * Plans the change for one transaction: which table to show as text after it, and the core highlight effects that
 * make Live Preview follow. Reads only the start state, the new document and the new selection.
 */
function extend(tr: Transaction, opts: () => EditorOptions): { effects: StateEffect<unknown>[] } | null {
	const core = coreHighlights();
	// Find (and other core code) removes every mark of the search class with a filter effect, also the mark of the
	// plugin. The add effect below comes after that filter in the same transaction, so the mark stays.
	const foreignFilter = !!core && !tr.annotation(own) && tr.effects.some((e) => e.is(core.filter));
	if (!tr.docChanged && !tr.selection && !foreignFilter) return null;
	const before = tr.startState.field(shownField, false);
	if (before === undefined) return null;
	const mapped = before && tr.docChanged ? { ...before, from: tr.changes.mapPos(before.from, -1), to: tr.changes.mapPos(before.to, 1), anchor: tr.changes.mapPos(before.anchor, 1) } : before;
	const doc = tr.newDoc;
	const head = (tr.selection ?? tr.startState.selection.map(tr.changes)).main.head;
	let next: Shown | null = null;
	const o = opts();
	if (o.enabled && !failed()) {
		if (mapped && !tr.docChanged && inside(mapped, head)) {
			next = mapped;
		} else {
			const line = doc.lineAt(head);
			if (line.text.includes('|')) {
				// A cursor in or next to the shown table: the fence scan was done when the cursor came in.
				const near = !!mapped && head >= mapped.from - 1 && head <= mapped.to + 1;
				const t = tableAt(doc, line.number, !near);
				if (t) next = { from: t.from, to: t.to, anchor: t.anchor, base: mapped && t.from === mapped.from ? mapped.base : tableText(doc, t) };
			}
		}
	}
	if (next && !mapped && !prepare(tr)) return null;
	if (next === mapped) return foreignFilter && next && core ? { effects: [core.add.of([core.mark.range(next.anchor, next.anchor + 1)])] } : null;
	const effects: StateEffect<unknown>[] = [setShown.of(next)];
	if (core) {
		const sameAnchor = !!next && !!mapped && next.anchor === mapped.anchor;
		if (mapped && !sameAnchor) {
			const old = mapped.anchor;
			effects.push(core.filter.of((from, _to, value) => !(value === core.mark && from === old)));
		}
		if (next && (!sameAnchor || foreignFilter)) effects.push(core.add.of([core.mark.range(next.anchor, next.anchor + 1)]));
	}
	return { effects };
}

/** First use in an editor: capture the core types and wrap the table widget. False when this Obsidian lacks them. */
function prepare(tr: Transaction): boolean {
	if (ready()) return true;
	const view = tr.startState.field(editorEditorField, false);
	const info = tr.startState.field(editorInfoField, false);
	if (!view || !info) return false;
	const captured = capture(view, info.editor);
	const patched = captured ? patchWidget(view, isShownAsText) : 'unsupported';
	// No table widget drawn now (for example the cursor jumped to a table out of view): try again on the next move.
	if (patched === 'retry') return false;
	if (patched !== 'ok') warnOnce();
	return patched === 'ok';
}

/** Captures the core types and wraps the table widget as soon as Live Preview draws a table in this view. */
function prepareView(view: EditorView): void {
	if (ready() || !view.dom.isConnected) return;
	const info = view.state.field(editorInfoField, false);
	if (!info || !capture(view, info.editor)) return;
	patchWidget(view, isShownAsText);
}

/** The check for core.ts: the table widget that starts at tableStart is shown as text after tr. */
function isShownAsText(tr: Transaction, tableStart: number): boolean {
	const s = tr.state.field(shownField, false);
	return !!s && tableStart >= s.from && tableStart <= s.to;
}

/** Views with this extension, for refresh() and unload. */
const views = new Set<EditorView>();

/** The core mark position of each view, kept from the last update. Unload uses it when the field is already gone. */
const anchors = new Map<EditorView, number>();

/** Removes the core mark at anchor from a view and makes Live Preview draw the widgets again. */
function dropMark(view: EditorView, anchor: number): void {
	const core = coreHighlights();
	if (!core || !view.dom.isConnected) return;
	const effects: StateEffect<unknown>[] = [core.filter.of((from, _to, value) => !(value === core.mark && from === anchor))];
	if (view.state.field(shownField, false) !== undefined) effects.push(setShown.of(null));
	view.dispatch({ effects, selection: view.state.selection, annotations: own.of(true), userEvent: 'select.ptt-refresh' });
}

/** Line class ptt-text-line for the lines of the shown table (tests and themes use it). */
function lineDecorations(state: EditorState): DecorationSet {
	const s = state.field(shownField, false);
	if (!s || !state.field(editorLivePreviewField, false)) return Decoration.none;
	const b = new RangeSetBuilder<Decoration>();
	const deco = Decoration.line({ class: 'ptt-text-line' });
	const doc = state.doc;
	const first = doc.lineAt(Math.min(s.from, doc.length)).number;
	const last = doc.lineAt(Math.min(s.to, doc.length)).number;
	for (let n = first; n <= last; n++) b.add(doc.line(n).from, doc.line(n).from, deco);
	return b.finish();
}

/** Replaces [from, to] with the aligned table text in one transaction that is its own undo step. */
export function dispatchAlign(view: EditorView, from: number, to: number, aligned: string): void {
	view.dispatch({ changes: { from, to, insert: aligned }, annotations: isolateHistory.of('full'), userEvent: 'input.ptt-align' });
}

/** The editor view of an Obsidian editor, from the views that have this extension, or null. */
export function viewOf(editor: unknown): EditorView | null {
	for (const view of views) if (view.state.field(editorInfoField, false)?.editor === editor) return view;
	return null;
}

/** Pro P1: aligns the table that the cursor left, in a later transaction of its own (one undo step). */
function alignLater(view: EditorView, left: Shown): void {
	window.setTimeout(() => {
		if (!views.has(view)) return;
		const state = view.state;
		if (left.from > state.doc.length) return;
		const line = state.doc.lineAt(left.from);
		const t = tableAt(state.doc, line.number, true);
		if (!t || t.from !== left.from) return;
		const head = state.selection.main.head;
		if (head >= t.from && head <= t.to) return;
		const text = tableText(state.doc, t);
		if (text === left.base) return;
		const aligned = alignTable(text.split('\n')).join('\n');
		if (aligned === text) return;
		dispatchAlign(view, t.from, t.to, aligned);
	}, 0);
}

/**
 * The Live Preview extension. opts() is read on each transaction, so a settings change needs only refresh().
 * onUnsupported runs once when this Obsidian version lacks a part that core.ts needs.
 */
export function plainTextTables(opts: () => EditorOptions, onUnsupported: (drawn: boolean) => void): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private readonly onPointer: (e: PointerEvent) => void;
			private readonly onMouse: (e: MouseEvent) => void;
			private handled = false;
			private prepareTimer: number | null = null;
			private checkTimer: number | null = null;
			/** True after check() added the mark again for the shown table. A second drawn result means fail safe. */
			private readded = false;

			constructor(readonly view: EditorView) {
				views.add(view);
				this.decorations = lineDecorations(view.state);
				this.onPointer = (e) => this.pointerDown(e);
				this.onMouse = (e) => {
					// The mouse events of a pointer press that the plugin used do not reach the table widget.
					if (this.handled) {
						e.preventDefault();
						e.stopPropagation();
					}
					if (e.type === 'click') this.handled = false;
				};
				view.contentDOM.addEventListener('pointerdown', this.onPointer, true);
				view.contentDOM.addEventListener('mousedown', this.onMouse, true);
				view.contentDOM.addEventListener('click', this.onMouse, true);
				this.prepareTimer = window.setTimeout(() => {
					this.prepareTimer = null;
					prepareView(view);
				}, 50);
			}

			update(u: ViewUpdate): void {
				const before = u.startState.field(shownField, false) ?? null;
				const after = u.state.field(shownField, false) ?? null;
				// A table that becomes text while an Obsidian cell editor of it has the focus: give the focus back.
				if (!before && after) {
					const active = this.view.dom.ownerDocument.activeElement;
					if (active && active.closest('.cm-table-widget') && this.view.contentDOM.contains(active)) window.setTimeout(() => this.view.focus(), 0);
				}
				if (after) anchors.set(this.view, after.anchor);
				else anchors.delete(this.view);
				// Check that Live Preview honours the mark: after a new shown table, a view change or an effect, the shown
				// table must not be drawn as a widget (check()).
				if (before !== after && (!before || !after || before.from !== after.from)) this.readded = false;
				// Desktop only: in the mobile emulation of CI the check saw a drawn table where the test saw text
				// (run 40633983165), so a false fail safe would turn the plugin off. Mobile keeps the same-transaction mark.
				if (!Platform.isMobile && after && this.checkTimer === null && ((!before && after) || before?.from !== after.from || u.viewportChanged || u.geometryChanged || u.transactions.some((t) => t.effects.some((e) => !e.is(setShown))))) {
					this.scheduleCheck(0, 50);
				}
				// Before the first use: take the table widget class from a drawn table, after this update.
				if (!ready() && this.prepareTimer === null && (u.docChanged || u.viewportChanged || u.geometryChanged)) {
					this.prepareTimer = window.setTimeout(() => {
						this.prepareTimer = null;
						prepareView(this.view);
					}, 50);
				}
				const o = opts();
				if (before !== after || u.docChanged || u.viewportChanged || u.transactions.some((t) => t.isUserEvent('select.ptt-refresh')) || u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false)) {
					this.decorations = lineDecorations(u.state);
				}
				// Pro P1: the cursor left a table (or moved to another one) in Live Preview.
				if (o.align && before && (!after || after.from !== u.changes.mapPos(before.from, -1)) && u.state.field(editorLivePreviewField, false)) {
					const left = { ...before, from: u.changes.mapPos(before.from, -1), to: u.changes.mapPos(before.to, 1), anchor: u.changes.mapPos(before.anchor, 1) };
					alignLater(this.view, left);
				}
			}

			scheduleCheck(attempt: number, ms: number): void {
				if (this.checkTimer !== null) window.clearTimeout(this.checkTimer);
				this.checkTimer = window.setTimeout(() => {
					this.checkTimer = null;
					this.check(attempt);
				}, ms);
			}

			/** True when Live Preview draws the shown table s as a widget in this view. */
			drawn(s: Shown): boolean {
				const view = this.view;
				return Array.from(view.contentDOM.querySelectorAll('.cm-table-widget')).some((el) => {
					// Only a widget that is in the document and has a box counts as drawn.
					if (!el.isConnected || el.getClientRects().length === 0) return false;
					try {
						const pos = view.posAtDOM(el);
						return pos >= s.from && pos <= s.to;
					} catch {
						return false;
					}
				});
			}

			/**
			 * Verifies the second core fact (core.ts): the shown table is not drawn. When it is drawn, the plugin adds the
			 * mark again once. When it is still drawn after that, this Obsidian does not honour the mark: fail safe, so
			 * the table editor of Obsidian works again (methods restored, marks removed, one notice). Live Preview can
			 * draw a little later (mobile layout), so a check that finds no widget looks once more after 300 ms, and the
			 * look after the mark was added again waits 400 ms.
			 */
			check(attempt: number): void {
				const view = this.view;
				const s = view.state.field(shownField, false);
				const core = coreHighlights();
				if (!s || !core || !view.dom.isConnected || failed()) return;
				if (!this.drawn(s)) {
					if (this.readded) this.readded = false;
					if (attempt === 0) this.scheduleCheck(1, 300);
					return;
				}
				if (this.readded) {
					failSafe();
					warnOnce(true);
					refresh();
					return;
				}
				this.readded = true;
				view.dispatch({
					effects: [core.filter.of((from, _to, value) => !(value === core.mark && from === s.anchor)), core.add.of([core.mark.range(s.anchor, s.anchor + 1)])],
					selection: view.state.selection,
					annotations: own.of(true),
					userEvent: 'select.ptt-refresh',
				});
				// The second look waits: in the mobile layout Live Preview can change the DOM a little later.
				this.scheduleCheck(attempt, 400);
			}

			/** Rule 5: a plain click on a cell of a rendered table puts the cursor at the end of that cell text. */
			pointerDown(e: PointerEvent): void {
				this.handled = false;
				const o = opts();
				const view = this.view;
				if (!o.enabled || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
				if (!view.state.field(editorLivePreviewField, false)) return;
				const target = e.target instanceof Element ? e.target : null;
				const cell = target?.closest('td, th');
				const widget = target?.closest('.cm-table-widget');
				if (!cell || !widget || !view.contentDOM.contains(widget)) return;
				if (target?.closest('a, button, input, select, textarea, .clickable-icon, .internal-link, .external-link, .table-row-btn, .table-col-btn')) return;
				// A cell that already has the Obsidian cell editor is left to Obsidian.
				if (cell.querySelector('.cm-editor')) return;
				const row = cell.closest('tr');
				if (!row) return;
				const rowIndex = Array.from(widget.querySelectorAll('tr')).indexOf(row);
				const colIndex = Array.from(row.children).filter((c) => c.matches('td, th')).indexOf(cell);
				if (rowIndex < 0 || colIndex < 0) return;
				let start: number;
				try {
					start = view.posAtDOM(widget);
				} catch {
					return;
				}
				const doc = view.state.doc;
				const t = tableAt(doc, doc.lineAt(start).number, true);
				if (!t) return;
				// Row 0 is the header line. The delimiter line has no row in the widget.
				const lineNo = t.lines.start + 1 + (rowIndex === 0 ? 0 : rowIndex + 1);
				if (lineNo > t.lines.end + 1) return;
				const line = doc.line(lineNo);
				const ch = cellCursor(line.text, colIndex);
				if (ch === null) return;
				e.preventDefault();
				e.stopPropagation();
				this.handled = true;
				view.focus();
				view.dispatch({ selection: { anchor: line.from + ch }, userEvent: 'select.pointer' });
			}

			destroy(): void {
				views.delete(this.view);
				if (this.prepareTimer !== null) window.clearTimeout(this.prepareTimer);
				if (this.checkTimer !== null) window.clearTimeout(this.checkTimer);
				// The extension went away (plugin off) while a table was text: remove the core mark after this update.
				const anchor = anchors.get(this.view);
				anchors.delete(this.view);
				const view = this.view;
				if (anchor !== undefined) window.setTimeout(() => dropMark(view, anchor), 0);
				this.view.contentDOM.removeEventListener('pointerdown', this.onPointer, true);
				this.view.contentDOM.removeEventListener('mousedown', this.onMouse, true);
				this.view.contentDOM.removeEventListener('click', this.onMouse, true);
			}
		},
		{ decorations: (v) => v.decorations },
	);
	notifyUnsupported = onUnsupported;
	return [shownField, EditorState.transactionExtender.of((tr) => extend(tr, opts)), plugin];
}

/** Applies a settings change in every editor: the extender runs again for the current cursor. */
export function refresh(): void {
	for (const view of views) {
		view.dispatch({ selection: view.state.selection, annotations: own.of(true), userEvent: 'select.ptt-refresh' });
	}
}

/** Plugin unload: removes the core mark from each editor, so every table renders again at once. */
export function removeAll(): void {
	for (const [view, anchor] of [...anchors]) dropMark(view, view.state.field(shownField, false)?.anchor ?? anchor);
	anchors.clear();
	views.clear();
}

/** For tests and the e2e: the shown table of a view. */
export function shownIn(view: EditorView): Shown | null {
	return view.state.field(shownField, false) ?? null;
}
