import { type Editor, Notice, Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, isPro, onProChange, proNotice, resetPro } from './pro';
import { ALIGN_COMMAND_LEAD, DEFAULT_SETTINGS, PlainTextTablesSettingTab, effectiveOptions, normalizeSettings, type PlainTextTablesSettings } from './settings';
import { dispatchAlign, plainTextTables, refresh, removeAll, viewOf, type EditorOptions } from './editor';
import { alignTable, findTableBy, hiddenLines } from './tables';
import { resetCore } from './core';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class PlainTextTablesPlugin extends Plugin {
	settings: PlainTextTablesSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: PlainTextTablesSettingTab | null = null;
	/** False after unload starts: the editor part then shows no table as text. */
	private active = false;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.register(onProChange(() => refresh()));
		this.settingTab = new PlainTextTablesSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.active = true;
		this.registerEditorExtension(
			plainTextTables(
				() => this.options(),
				(drawn) =>
					new Notice(
						drawn
							? 'Obsidian still draws the table that has the cursor. Table text is off until Obsidian restarts.'
							: 'This Obsidian version does not let the plugin show table text. Tables stay as Obsidian draws them.',
					),
			),
		);

		this.addCommand({
			id: 'toggle-table-text',
			name: 'Toggle table text',
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				this.applySettings();
				new Notice(this.settings.enabled ? 'Table text in Live Preview is on.' : 'Table text in Live Preview is off.');
			},
		});

		this.addCommand({
			id: 'align-table',
			name: 'Align the current table',
			editorCallback: (editor: Editor) => {
				if (!isPro()) {
					proNotice(ALIGN_COMMAND_LEAD);
					return;
				}
				if (!alignAtCursor(editor)) new Notice('No table here. Click in a table first.');
			},
		});

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		this.active = false;
		removeAll();
		resetCore();
		resetPro();
	}

	/** The options that the editor part reads on each transaction. */
	options(): EditorOptions {
		if (!this.active) return { enabled: false, align: false };
		return effectiveOptions(this.settings, isPro());
	}

	/** A setting changed: each editor applies it at once, and the settings tab shows it. */
	applySettings(): void {
		refresh();
		this.settingTab?.update();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<PlainTextTablesSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/** Pro command: pads the cells of the table at the cursor. Returns false when the cursor is not in a table. */
export function alignAtCursor(editor: Editor): boolean {
	const at = editor.getCursor().line;
	const count = editor.lineCount();
	const t = findTableBy((i) => editor.getLine(i), count, at, () => false);
	if (!t) return false;
	const above: string[] = [];
	for (let i = 0; i <= t.start; i++) above.push(editor.getLine(i));
	if (hiddenLines(above)[t.start]) return false;
	const lines: string[] = [];
	for (let i = t.start; i <= t.end; i++) lines.push(editor.getLine(i));
	const aligned = alignTable(lines);
	if (aligned.join('\n') === lines.join('\n')) return true;
	const from = editor.posToOffset({ line: t.start, ch: 0 });
	const to = editor.posToOffset({ line: t.end, ch: lines[lines.length - 1]!.length });
	// One undo step of its own: through the editor view with a history boundary, as the alignment on leave.
	const view = viewOf(editor);
	if (view) dispatchAlign(view, from, to, aligned.join('\n'));
	else editor.replaceRange(aligned.join('\n'), editor.offsetToPos(from), editor.offsetToPos(to));
	return true;
}
