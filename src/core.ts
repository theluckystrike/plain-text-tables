// The link to three parts of Obsidian that are not in obsidian.d.ts. Parts 1 and 3 are checked before use; part 2 is
// checked after use (editor.ts check()). When one is missing or not honoured, ready() is false, the methods of
// Obsidian are restored and the plugin changes nothing (main.ts shows one notice).
//
// Facts from Obsidian 1.14.5 (app.js), tested on 1.13.4 and the latest version in CI:
// 1. Editor.addHighlights(ranges, cls, removePrevious) adds a mark to a core StateField (the field of the search
//    highlights). It dispatches one transaction with a filter effect and an add effect.
// 2. Live Preview does not draw the table widget when a mark with the class "obsidian-search-match-highlight" from
//    that field touches the table range. This is how a search match in a table shows the table text.
// 3. The table widget has receiveSelection(transaction) and receiveUpdate(transaction, text). A widget that is not
//    drawn still gets the calls: the first moves the focus into a cell editor when the cursor is in its range, the
//    second pads and escapes the table text. For a table that the plugin shows as text, the plugin skips the first and
//    makes the second drop the widget. receiveSelection and at least one update method must exist.
import type { Range, StateEffect, StateEffectType, Transaction } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { EditorPosition } from 'obsidian';

/** The class of the core search highlight. Live Preview skips the table widget for a mark of exactly this class. */
export const MATCH_CLASS = 'obsidian-search-match-highlight';

type Keep = (from: number, to: number, value: Decoration) => boolean;

export interface CoreHighlights {
	/** Adds marks to the core highlight field. */
	add: StateEffectType<Range<Decoration>[]>;
	/** Keeps only the marks for which the function returns true. */
	filter: StateEffectType<Keep>;
	/** The shared mark of MATCH_CLASS. Live Preview compares marks by identity with this value. */
	mark: Decoration;
}

interface HighlightEditor {
	addHighlights(ranges: { from: EditorPosition; to: EditorPosition }[], cls: string, removePrevious?: boolean, range?: unknown): void;
}

let highlights: CoreHighlights | null = null;

/** The captured core types, or null before capture() works. */
export function coreHighlights(): CoreHighlights | null {
	return highlights;
}

/** True when the plugin can show a table as text in this Obsidian version. */
export function ready(): boolean {
	return highlights !== null && widgetPatched && !failedFlag;
}

function effectType(e: StateEffect<unknown>): StateEffectType<unknown> | null {
	const t = (e as unknown as { type?: unknown }).type;
	return t && typeof t === 'object' ? (t as StateEffectType<unknown>) : null;
}

/**
 * Reads the core effect types from one call of editor.addHighlights. The call goes to a stub dispatch, so the editor
 * does not change. Needs a note with at least one character. Returns true when the types are known.
 */
export function capture(view: EditorView, editor: unknown): boolean {
	if (highlights) return true;
	const ed = editor as Partial<HighlightEditor> | null;
	if (!ed || typeof ed.addHighlights !== 'function') return false;
	const doc = view.state.doc;
	if (doc.length < 1) return false;
	const first = doc.line(1);
	const to: EditorPosition = first.length > 0 ? { line: 0, ch: 1 } : { line: 1, ch: 0 };
	let spec: unknown = null;
	// The stub takes the place of view.dispatch for this one call. CodeMirror binds dispatch on the view object.
	const slot = view as unknown as Record<string, unknown>;
	const own = Object.prototype.hasOwnProperty.call(slot, 'dispatch');
	const real = slot.dispatch;
	slot.dispatch = (...args: unknown[]): void => {
		spec = args[0];
	};
	try {
		ed.addHighlights([{ from: { line: 0, ch: 0 }, to }], MATCH_CLASS, true);
	} catch {
		return false;
	} finally {
		if (own) slot.dispatch = real;
		else delete slot.dispatch;
	}
	const effects = (spec as { effects?: unknown } | null)?.effects;
	if (!Array.isArray(effects)) return false;
	let add: StateEffectType<Range<Decoration>[]> | null = null;
	let filter: StateEffectType<Keep> | null = null;
	let mark: Decoration | null = null;
	for (const e of effects as StateEffect<unknown>[]) {
		const type = effectType(e);
		if (!type) continue;
		if (Array.isArray(e.value)) {
			const r = (e.value as Range<Decoration>[])[0];
			if (r && r.value instanceof Decoration) {
				add = type as StateEffectType<Range<Decoration>[]>;
				mark = r.value;
			}
		} else if (typeof e.value === 'function') {
			filter = type as StateEffectType<Keep>;
		}
	}
	if (!add || !filter || !mark) return false;
	highlights = { add, filter, mark };
	return true;
}

/** Answers "does the plugin show the table that starts at this position as text, in this transaction?". */
export type ShownAsText = (tr: Transaction, tableStart: number) => boolean;

interface TableWidget {
	start?: unknown;
	receiveSelection(tr: Transaction): void;
	containsSelection(sel: unknown): boolean;
}

type Method = (this: TableWidget, ...args: unknown[]) => unknown;

/** Each wrapped method: the object that owns it, its name, the original method and the wrapper of this plugin. */
const wrapped: { owner: Record<string, unknown>; name: string; original: Method; wrapper: Method }[] = [];
let widgetPatched = false;
let shownAsText: ShownAsText | null = null;
/** True after the plugin saw Live Preview draw a table in spite of the mark. The editor part stops for the session. */
let failedFlag = false;

/** True after failSafe(): the plugin does not show tables as text until Obsidian restarts. */
export function failed(): boolean {
	return failedFlag;
}

/**
 * Live Preview drew a table under the mark (a later Obsidian can do this). Restores the methods of Obsidian and turns
 * the editor part off for this session. The caller shows the notice and removes the marks.
 */
export function failSafe(): void {
	failedFlag = true;
	unpatchWidget();
}

function isTableWidget(w: unknown): w is TableWidget {
	const o = w as Partial<TableWidget> | null;
	return !!o && typeof o.receiveSelection === 'function' && typeof o.containsSelection === 'function';
}

/** A table widget object that Live Preview draws in the view, or null when no table is drawn. */
function findWidget(view: EditorView): TableWidget | null {
	let found: TableWidget | null = null;
	for (const source of view.state.facet(EditorView.decorations)) {
		const set = typeof source === 'function' ? source(view) : source;
		set.between(0, view.state.doc.length, (_f, _t, deco) => {
			const w = (deco.spec as { widget?: unknown }).widget;
			if (isTableWidget(w)) {
				found = w;
				return false;
			}
			return undefined;
		});
		if (found) break;
	}
	return found;
}

/** The update methods of the table widget. Each returns true when Live Preview may keep the widget for the new text. */
const UPDATE_METHODS = ['receiveUpdate', 'receiveIncompleteUpdate'];

/**
 * Wraps methods of the table widget class once. For a table that the plugin shows as text, receiveSelection does
 * nothing (it would move the focus into a hidden cell editor), and the update methods return false, so Live Preview
 * drops the hidden widget and it cannot pad or escape the text. The class comes from a widget that Live Preview draws
 * in the view. Returns 'ok' when the wraps are in place, 'retry' when no table widget is drawn now, and 'unsupported'
 * when the class does not have its own receiveSelection and at least one update method, or after failSafe().
 */
export function patchWidget(view: EditorView, check: ShownAsText): 'ok' | 'retry' | 'unsupported' {
	shownAsText = check;
	if (failedFlag) return 'unsupported';
	if (widgetPatched) return 'ok';
	const w = findWidget(view);
	if (!w) return 'retry';
	const proto = Object.getPrototypeOf(w) as Record<string, unknown>;
	const hasOwn = (o: object, name: string): boolean => Object.prototype.hasOwnProperty.call(o, name);
	// The object in the prototype chain that owns the method (the mobile layout can use a subclass of the widget).
	const ownerOf = (name: string): Record<string, unknown> | null => {
		for (let o: Record<string, unknown> | null = proto; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as Record<string, unknown> | null) {
			if (hasOwn(o, name)) return typeof o[name] === 'function' ? o : null;
		}
		return null;
	};
	const updates = UPDATE_METHODS.map((name) => ({ name, owner: ownerOf(name) })).filter((u): u is { name: string; owner: Record<string, unknown> } => u.owner !== null);
	if (!hasOwn(proto, 'receiveSelection') || typeof proto.receiveSelection !== 'function' || updates.length === 0) return 'unsupported';
	const shown = (tr: Transaction, start: number): boolean => !!shownAsText && start >= 0 && shownAsText(tr, start);
	const receive = proto.receiveSelection as Method;
	const receiveWrapper: Method = function (this: TableWidget, ...args: unknown[]): unknown {
		const tr = args[0] as Transaction;
		if (shown(tr, typeof this.start === 'number' ? this.start : -1)) return undefined;
		return receive.apply(this, args);
	};
	proto.receiveSelection = receiveWrapper;
	wrapped.push({ owner: proto, name: 'receiveSelection', original: receive, wrapper: receiveWrapper });
	for (const { name, owner } of updates) {
		const original = owner[name] as Method;
		const wrapper: Method = function (this: TableWidget, ...args: unknown[]): unknown {
			const tr = args[0] as Transaction;
			if (shown(tr, typeof this.start === 'number' ? tr.changes.mapPos(this.start) : -1)) return false;
			return original.apply(this, args);
		};
		owner[name] = wrapper;
		wrapped.push({ owner, name, original, wrapper });
	}
	widgetPatched = true;
	return 'ok';
}

/**
 * Restores the table widget class. A method goes back only when it is still the wrapper of this plugin: a wrap that
 * another plugin added later stays in place.
 */
export function unpatchWidget(): void {
	for (const { owner, name, original, wrapper } of wrapped) if (owner[name] === wrapper) owner[name] = original;
	wrapped.length = 0;
	widgetPatched = false;
	shownAsText = null;
}

/**
 * Plugin unload: restores the table widget class. The captured effect types stay: they belong to this Obsidian
 * session, and an editor that the plugin leaves later still needs them to remove its mark.
 */
export function resetCore(): void {
	unpatchWidget();
}
