import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import type Plugin from '../../src/main';

const DRAW_ALL = 'Align columns when you leave a table';
const LEAD_DRAW_ALL = 'Align columns when you leave a table is a Pro feature.';
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

interface Notice { text: string; buttons: number }
interface Row { disabled: boolean; checked: boolean | null; value: string | null }

/**
 * Text and Sponsor button count of each shown notice. Obsidian puts a notice in the document of activeWindow. While the
 * settings modal is open in this test, activeWindow is not the main window, so the test reads the document of activeWindow.
 */
async function notices(): Promise<Notice[]> {
	return browser.execute(() => [...(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));
}

/** Opens the settings tab of the plugin. Removes old notices. */
async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		for (const doc of new Set([document, (window as unknown as { activeWindow: Window }).activeWindow.document])) doc.querySelectorAll('.notice').forEach((n) => n.remove());
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(id);
	}, pluginId);
	await browser.waitUntil(async () => (await row(DRAW_ALL)) !== null, { timeout: 5000 }).catch(async () => {
		throw new Error(`The settings tab did not show the Pro rows: ${await tabDump()}`);
	});
}

/** The names and control classes of the rows in the open tab, for a failure message. */
async function tabDump(): Promise<string> {
	return browser.execute(() => {
		const root = (window as unknown as { app: { setting: { activeTab?: { containerEl: HTMLElement } } } }).app.setting.activeTab?.containerEl ?? document.body;
		return [...root.querySelectorAll('.setting-item')].map((el) => `${el.querySelector('.setting-item-name')?.textContent ?? '?'} [${el.querySelector('.setting-item-control')?.innerHTML.slice(0, 160) ?? ''}]`).join(' | ').slice(0, 1500);
	});
}

/** The state of the control in the settings row with this name, or null when the row is not shown. */
async function row(name: string): Promise<Row | null> {
	return browser.execute((label: string) => {
		const root = (window as unknown as { app: { setting: { activeTab?: { containerEl: HTMLElement } } } }).app.setting.activeTab?.containerEl ?? document.body;
		const item = [...root.querySelectorAll('.setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent?.trim() === label);
		if (!item) return null;
		const toggle = item.querySelector('.checkbox-container');
		const select = item.querySelector('select');
		const box = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
		if (toggle || box) return { disabled: !!toggle?.classList.contains('is-disabled') || !!box?.disabled || item.classList.contains('is-disabled'), checked: toggle ? toggle.classList.contains('is-enabled') : !!box?.checked, value: null };
		if (select) return { disabled: select.disabled, checked: null, value: select.value };
		return null;
	}, name);
}

/** Clicks the toggle of the row, or selects a value in its dropdown, as a user does. */
async function useControl(name: string, value?: string): Promise<void> {
	await browser.execute((label: string, v: string | null) => {
		const root = (window as unknown as { app: { setting: { activeTab?: { containerEl: HTMLElement } } } }).app.setting.activeTab?.containerEl ?? document.body;
		const item = [...root.querySelectorAll('.setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent?.trim() === label);
		if (!item) throw new Error(`no row ${label}`);
		// A real click moves the focus into the row. Obsidian does not draw a focused control again, so the test focuses it too.
		if (v === null) { const box = (item.querySelector('.checkbox-container') ?? item.querySelector('input[type="checkbox"]')) as HTMLElement; box.focus(); box.click(); return; }
		const select = item.querySelector('select')!;
		select.focus();
		select.value = v;
		select.dispatchEvent(new Event('change', { bubbles: true }));
	}, name, value ?? null);
}

/** Pro state, settings, notices and the toggle row, for a failure message. */
async function diagnose(): Promise<string> {
	const state = await browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
		const pro = p.pro as unknown as { isPro(): boolean; hasToken(): boolean; getState(): { status: string } } | null;
		return { isPro: pro?.isPro() ?? null, token: pro?.hasToken() ?? null, status: pro?.getState().status ?? null, settings: { ...p.settings } };
	}, pluginId);
	return JSON.stringify({ state, notices: await notices(), row: await row(DRAW_ALL) });
}

async function settings(): Promise<{ align: boolean }> {
	return browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
		return { align: p.settings.align };
	}, pluginId);
}

async function closeAndReset(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
		(app as unknown as { setting: { close(): void } }).setting.close();
		p.settings.align = false;
		await p.saveData(p.settings);
		for (const doc of new Set([document, (window as unknown as { activeWindow: Window }).activeWindow.document])) doc.querySelectorAll('.notice').forEach((n) => n.remove());
	}, pluginId);
}

describe('Pro settings for a free user and a Pro user', () => {
	it('A9 a free user who turns on the Pro setting gets a Pro notice with a Sponsor button and no change', async () => {
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!.pro?.signOut();
		}, pluginId);
		await browser.waitUntil(async () => !(await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!.pro?.isPro() ?? false, pluginId)), { timeout: 5000, timeoutMsg: 'Pro is still on after sign out.' });
		await openTab();
		expect(await row(DRAW_ALL)).toEqual({ disabled: false, checked: false, value: null });

		for (const [name, lead] of [[DRAW_ALL, LEAD_DRAW_ALL]] as const) {
			await useControl(name);
			await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(lead)), { timeout: 5000 }).catch(async () => {
				throw new Error(`No Pro notice after the ${name} toggle: ${await diagnose()}`);
			});
			const notice = (await notices()).find((n) => n.text.includes(lead))!;
			expect(notice.text).toContain(`${lead} ${PITCH}`);
			expect(notice.buttons).toBe(1);
			await browser.waitUntil(async () => (await row(name))?.checked === false, { timeout: 5000, timeoutMsg: `The ${name} toggle does not show the saved value (off) again.` });
		}

		expect(await settings()).toEqual({ align: false });
		const saved = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			const data = (await p.loadData()) as { align?: boolean } | null;
			return { align: data?.align ?? false };
		}, pluginId);
		expect(saved).toEqual({ align: false });
		await closeAndReset();
	});

	it('A9 a Pro user who turns on the same setting changes them (simulated Sponsors check)', async () => {
		const pro = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			if (!p.pro) throw new Error('Sponsors manager missing');
			const manager = p.pro as unknown as { opts: { http: unknown }; refreshNow(): Promise<unknown>; isPro(): boolean };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await manager.refreshNow();
			return manager.isPro();
		}, pluginId);
		expect(pro).toBe(true);
		try {
			await openTab();
			await useControl(DRAW_ALL);
			await browser.waitUntil(async () => (await settings()).align, { timeout: 5000, timeoutMsg: 'A Pro user could not turn on Align columns when you leave a table.' });
			expect(await row(DRAW_ALL)).toEqual({ disabled: false, checked: true, value: null });
			expect((await notices()).filter((n) => n.text.includes('Pro feature')).length).toBe(0);
		} finally {
			await browser.executeObsidian(({ app }, id) => {
				(app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!.pro?.signOut();
			}, pluginId);
			await closeAndReset();
		}
	});
});
