// Pure Markdown table logic. No Obsidian and no CodeMirror imports: golden vectors test each function
// (packages/spec/vectors/plain-text-tables.json).

/** A table as 0-based line numbers: the header line and the last row line (both included). */
export interface TableLines {
	start: number;
	end: number;
}

/** One cell of a row: the text between two pipes, and its offsets in the row text. */
export interface Cell {
	/** Cell text without the spaces around it. */
	text: string;
	/** Offset of the first character after the opening pipe (or the row start). */
	from: number;
	/** Offset of the closing pipe (or the row end). */
	to: number;
	/** Offset of the first character of text (from, when the cell is empty). */
	textFrom: number;
	/** Offset after the last character of text (textFrom, when the cell is empty). */
	textTo: number;
}

/** Leading spaces of a line, with a tab counted as 4. */
function indentOf(line: string): number {
	let n = 0;
	for (const ch of line) {
		if (ch === ' ') n += 1;
		else if (ch === '\t') n += 4;
		else break;
	}
	return n;
}

/** Offsets of the pipes that split cells: not after a backslash. */
function pipeOffsets(line: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '\\') {
			i++;
			continue;
		}
		if (ch === '|') out.push(i);
	}
	return out;
}

/** True when the line can be a table row: it has a pipe, it is not in a quote, and it is not indented code. */
export function isRowLine(line: string): boolean {
	if (indentOf(line) >= 4) return false;
	const t = line.trim();
	if (t === '' || t.startsWith('>')) return false;
	return pipeOffsets(line).length > 0;
}

/** The cells of a row. A pipe at the start or the end of the row is an edge, not a cell border. */
export function splitRow(line: string): Cell[] {
	const borders = pipeOffsets(line);
	const first = line.length - line.trimStart().length;
	const last = line.trimEnd().length;
	let start = first;
	let end = last;
	if (borders.length > 0 && borders[0] === first) {
		start = first + 1;
		borders.shift();
	}
	if (borders.length > 0 && borders[borders.length - 1] === last - 1) {
		end = last - 1;
		borders.pop();
	}
	// Each cell runs from the end of one border to the next border.
	const starts = [start, ...borders.map((p) => p + 1)];
	const ends = [...borders, end];
	const cells: Cell[] = [];
	for (let i = 0; i < starts.length; i++) {
		const from = starts[i]!;
		const to = ends[i]!;
		const raw = line.slice(from, to);
		const lead = raw.length - raw.trimStart().length;
		const text = raw.trim();
		const textFrom = text === '' ? from : from + lead;
		cells.push({ text, from, to, textFrom, textTo: textFrom + text.length });
	}
	return cells;
}

const DELIM_CELL = /^:?-+:?$/;

/** True when the line is a delimiter row, for example `| --- | :-: |`. It must hold a pipe. */
export function isDelimiterRow(line: string): boolean {
	if (!isRowLine(line)) return false;
	const cells = splitRow(line);
	return cells.length > 0 && cells.every((c) => DELIM_CELL.test(c.text.replace(/\s+/g, '')));
}

/** The column alignments of a delimiter row: left, center, right or null. */
export function alignments(delimiter: string): (null | 'left' | 'center' | 'right')[] {
	return splitRow(delimiter).map((c) => {
		const t = c.text.replace(/\s+/g, '');
		const l = t.startsWith(':');
		const r = t.endsWith(':') && t.length > 1;
		if (l && r) return 'center';
		if (r) return 'right';
		if (l) return 'left';
		return null;
	});
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const RULE = /^ {0,3}([-*_])( *\1){2,} *$/;

/**
 * For each line: true when it is inside a fenced code block, a math block or the front matter (the fence lines too).
 * One pass from the top of the note.
 */
export function hiddenLines(lines: readonly string[]): boolean[] {
	const out = new Array<boolean>(lines.length).fill(false);
	let i = 0;
	// Front matter: "---" on the first line, up to the next "---" or "...".
	if (lines.length > 0 && lines[0]!.trimEnd() === '---') {
		for (let j = 1; j < lines.length; j++) {
			const t = lines[j]!.trimEnd();
			if (t === '---' || t === '...') {
				for (let k = 0; k <= j; k++) out[k] = true;
				i = j + 1;
				break;
			}
		}
	}
	let fence: { ch: string; len: number } | null = null;
	let math = false;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		if (fence) {
			out[i] = true;
			const m = FENCE.exec(line);
			if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len && line.trim() === m[1]) fence = null;
			continue;
		}
		if (math) {
			out[i] = true;
			if (line.trim().endsWith('$$')) math = false;
			continue;
		}
		const m = FENCE.exec(line);
		if (m) {
			fence = { ch: m[1]![0]!, len: m[1]!.length };
			out[i] = true;
			continue;
		}
		const t = line.trim();
		if (t.startsWith('$$') && indentOf(line) < 4) {
			out[i] = true;
			if (!(t.length >= 4 && t.endsWith('$$'))) math = true;
		}
	}
	return out;
}

/** True when a table may start right under this line: no line, a blank line, a heading or a rule. */
function canPrecede(line: string | undefined): boolean {
	if (line === undefined) return true;
	if (line.trim() === '') return true;
	return HEADING.test(line) || RULE.test(line);
}

/**
 * The table that holds line `at`, or null. Reads lines through get(i); count is the number of lines.
 * hidden(i) is true for a line in code, math or front matter. A table is a header row, a delimiter row, and the next
 * row lines. The line above the header must be blank, a heading or a rule (a text line
 * above makes the header part of a paragraph, as in Obsidian).
 */
export function findTableBy(get: (i: number) => string, count: number, at: number, hidden: (i: number) => boolean): TableLines | null {
	if (at < 0 || at >= count) return null;
	const row = (i: number): boolean => i >= 0 && i < count && !hidden(i) && isRowLine(get(i));
	if (!row(at)) return null;
	// The line above a header is not a row line, so the header is the first line of the run of row lines.
	let header = at;
	while (row(header - 1)) header--;
	const d = header + 1;
	if (!row(d) || !isDelimiterRow(get(d))) return null;
	// The cell counts may differ: Obsidian can draw such a table while you type the delimiter row, so the plugin
	// treats it as a table too. A mark on a line that Obsidian does not draw as a table changes nothing.
	if (!canPrecede(header > 0 ? get(header - 1) : undefined)) return null;
	let end = d;
	while (row(end + 1) && !isDelimiterRow(get(end + 1))) end++;
	if (at > end) return null;
	return { start: header, end };
}

/** findTableBy on an array of lines. */
export function findTable(lines: readonly string[], at: number): TableLines | null {
	const hidden = hiddenLines(lines);
	return findTableBy((i) => lines[i]!, lines.length, at, (i) => hidden[i]!);
}

/**
 * The cursor offset in a row for a click on cell `col`: the end of the cell text, or one space after the border
 * when the cell is empty. Null when the row has no such cell.
 */
export function cellCursor(line: string, col: number): number | null {
	const cell = splitRow(line)[col];
	if (!cell) return null;
	if (cell.text !== '') return cell.textTo;
	return Math.min(cell.from + 1, cell.to);
}

/** Width of one code point: 2 for wide East Asian characters, 0 for combining marks and joiners, else 1. */
function codePointWidth(c: number): number {
	if ((c >= 0x300 && c <= 0x36f) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) return 0;
	const wide =
		(c >= 0x1100 && c <= 0x115f) ||
		(c >= 0x2e80 && c <= 0xa4cf) ||
		(c >= 0xac00 && c <= 0xd7a3) ||
		(c >= 0xf900 && c <= 0xfaff) ||
		(c >= 0xfe30 && c <= 0xfe4f) ||
		(c >= 0xff00 && c <= 0xff60) ||
		(c >= 0xffe0 && c <= 0xffe6) ||
		(c >= 0x1f300 && c <= 0x1faff) ||
		(c >= 0x20000 && c <= 0x3fffd);
	return wide ? 2 : 1;
}

const EMOJI = /\p{Extended_Pictographic}/u;
/** Emoji that show as text unless VS16 (U+FE0F) follows, for example the digits and simple symbols. */
const TEXT_DEFAULT = /^[#*0-9\u00a9\u00ae\u203c\u2049\u2122\u2139\u2194-\u2199\u21a9\u21aa\u2328\u23cf\u23ed-\u23ef\u23f1\u23f2\u23f8-\u23fa\u24c2\u25aa\u25ab\u25b6\u25c0\u25fb\u25fc\u2600-\u2604\u260e\u2611\u2618\u261d\u2620\u2622\u2623\u2626\u262a\u262e\u262f\u2638-\u263a\u2640\u2642\u265f\u2660\u2663\u2665\u2666\u2668\u267b\u267e\u2692\u2694-\u2697\u2699\u269b\u269c\u26a0\u26a7\u26b0\u26b1\u26c8\u26cf\u26d1\u26d3\u26e9\u26f0\u26f1\u26f4\u26f7\u26f8\u2702\u2708\u2709\u270c\u270d\u270f\u2712\u2714\u2716\u271d\u2721\u2733\u2734\u2744\u2747\u2763\u2764\u27a1\u2934\u2935\u2b05-\u2b07\u3030\u303d\u3297\u3299]$/u;

/** Display width of one grapheme cluster: an emoji cluster (also a ZWJ sequence) is 2, else the sum of its code points. */
function clusterWidth(cluster: string): number {
	if (EMOJI.test(cluster)) {
		const first = String.fromCodePoint(cluster.codePointAt(0)!);
		if (cluster.includes('\ufe0f') || cluster.includes('\u200d') || !TEXT_DEFAULT.test(first)) return 2;
	}
	let w = 0;
	for (const ch of cluster) w += codePointWidth(ch.codePointAt(0)!);
	return w;
}

let segmenter: Intl.Segmenter | null | undefined;

/**
 * Display width of text in a monospace font, by grapheme cluster (Intl.Segmenter): 2 for wide East Asian characters
 * and emoji (also a ZWJ sequence such as a family), 0 for combining marks, else 1. ESTIMATE: fonts can differ.
 */
export function textWidth(text: string): number {
	if (segmenter === undefined) segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
	if (!segmenter) {
		let w = 0;
		for (const ch of text) w += codePointWidth(ch.codePointAt(0)!);
		return w;
	}
	let w = 0;
	for (const { segment } of segmenter.segment(text)) w += clusterWidth(segment);
	return w;
}

function pad(text: string, width: number, align: null | 'left' | 'center' | 'right'): string {
	const gap = Math.max(0, width - textWidth(text));
	if (align === 'right') return ' '.repeat(gap) + text;
	if (align === 'center') {
		const left = Math.floor(gap / 2);
		return ' '.repeat(left) + text + ' '.repeat(gap - left);
	}
	return text + ' '.repeat(gap);
}

/**
 * Pro: the table lines with the cells padded so the pipes line up. Row 2 must be the delimiter row. The header
 * cell count sets the columns: a short row gets empty cells, and the cells after the last column stay as they are.
 * Each line gets a pipe at the start and the end, and the indent of the header line. Returns the input when line 2
 * is not a delimiter row.
 */
export function alignTable(lines: readonly string[]): string[] {
	if (lines.length < 2 || !isDelimiterRow(lines[1]!)) return [...lines];
	const indent = lines[0]!.slice(0, lines[0]!.length - lines[0]!.trimStart().length);
	const header = splitRow(lines[0]!);
	const n = header.length;
	const aligns = alignments(lines[1]!).slice(0, n);
	const rows = lines.map((l) => splitRow(l).map((c) => c.text));
	const widths = new Array<number>(n).fill(3);
	rows.forEach((cells, r) => {
		if (r === 1) return;
		for (let c = 0; c < n; c++) widths[c] = Math.max(widths[c]!, textWidth(cells[c] ?? ''));
	});
	return rows.map((cells, r) => {
		if (r === 1) {
			const parts = widths.map((w, c) => {
				const a = aligns[c] ?? null;
				const dashes = '-'.repeat(Math.max(1, w - (a === 'center' ? 2 : a ? 1 : 0)));
				if (a === 'center') return `:${dashes}:`;
				if (a === 'left') return `:${dashes}`;
				if (a === 'right') return `${dashes}:`;
				return dashes;
			});
			return `${indent}| ${parts.join(' | ')} |`;
		}
		const main = widths.map((w, c) => pad(cells[c] ?? '', w, aligns[c] ?? null));
		const extra = cells.slice(n);
		return `${indent}| ${[...main, ...extra].join(' | ')} |`;
	});
}
