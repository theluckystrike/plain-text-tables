import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import type { EditorOptions } from './editor';
import { PRO_UI, isPro, proNotice } from './pro';
import type PlainTextTablesPlugin from './main';

export interface PlainTextTablesSettings {
	/** Rule 1: show the table text while the cursor is in the table. */
	enabled: boolean;
	/** Pro P1: align the columns when the cursor leaves a changed table. */
	align: boolean;
}

export const DEFAULT_SETTINGS: PlainTextTablesSettings = {
	enabled: true,
	align: false,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<PlainTextTablesSettings> | null | undefined): PlainTextTablesSettings {
	const s = saved ?? {};
	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SETTINGS.enabled,
		align: typeof s.align === 'boolean' ? s.align : DEFAULT_SETTINGS.align,
	};
}

/** The options in effect. Without Pro, P1 is off. */
export function effectiveOptions(settings: PlainTextTablesSettings, pro: boolean): EditorOptions {
	return {
		enabled: settings.enabled,
		align: pro && settings.align,
	};
}

/** First sentences of the Pro notices. A free user who turns on a Pro setting gets the notice; the value is not saved. */
export const PRO_LEADS: Partial<Record<keyof PlainTextTablesSettings, string>> = {
	align: 'Align columns when you leave a table is a Pro feature.',
};

/** First sentence of the Pro notice of the "Align the current table" command. */
export const ALIGN_COMMAND_LEAD = 'Align the current table is a Pro feature.';

export const NAMES = {
	enabled: 'Show table text when the cursor is in a table',
	align: 'Align columns when you leave a table',
} as const;

export class PlainTextTablesSettingTab extends PluginSettingTab {
	plugin: PlainTextTablesPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: PlainTextTablesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: NAMES.enabled,
				desc: 'In Live Preview, a table shows as Markdown text while the cursor is in it. When the cursor leaves, Obsidian draws the table again. Source mode and Reading view do not change.',
				control: { type: 'toggle', key: 'enabled', defaultValue: DEFAULT_SETTINGS.enabled },
			},
			{
				name: NAMES.align,
				desc: 'Pro. When the cursor leaves a table that you changed, pad the cells so that the pipes line up. Undo removes the padding in one step.',
				control: { type: 'toggle', key: 'align', defaultValue: DEFAULT_SETTINGS.align },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: the alignment setting above and the command "Align the current table" work.'
					: 'Free version: each table shows as text while the cursor is in it. Pro adds column alignment when you leave a table, and the command "Align the current table".',
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	getControlValue(key: string): unknown {
		// A free user sees the values in effect. The stored choice stays for the time that Pro comes back.
		if (key === 'align' && !isPro()) return false;
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const lead = PRO_LEADS[key as keyof PlainTextTablesSettings];
		if (lead && !isPro() && value === true) {
			// Free users can turn on the Pro settings: the notice shows what Pro adds and how to get it. Nothing is saved.
			proNotice(lead);
			// Obsidian does not draw a control again while it has the focus. Move the focus out, then draw the tab
			// again, so the row shows the value in effect.
			const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
			if (active && this.containerEl.contains(active)) active.blur();
			this.update();
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.applySettings();
	}
}
