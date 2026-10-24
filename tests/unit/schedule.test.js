import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const MIN = 60_000;
const NOW = Date.parse('2026-10-24T15:00:00.000Z');
const dirs = [];

async function loadBot() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kyara-schedule-'));
	dirs.push(dir);
	process.env.KYARA_DATA_DIR = dir;
	process.env.DASHBOARD_PASSWORD = '';
	vi.resetModules();
	return import('../../src/lib/server/bot.js');
}

function account(patch = {}) {
	return {
		settings: { pollMinutes: 90, smart: false, ...patch.settings },
		bot: { lastRunAt: null, lastError: null, ...patch.bot },
		account: { freePacks: 0, freePacksMax: 10, nextFreeAt: null, ...patch.account }
	};
}

afterEach(() => {
	dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
	dirs.length = 0;
});

describe('computeNextRun', () => {
	it('respecte l’intervalle demandé quand rien n’est en attente', async () => {
		const { computeNextRun } = await loadBot();
		expect(computeNextRun(account(), NOW)).toBe(NOW + 90 * MIN);
	});

	it('repasse vite quand un booster bonus attend', async () => {
		const { computeNextRun } = await loadBot();
		expect(computeNextRun(account({ account: { bonusPacks: 2 } }), NOW)).toBe(NOW + 5 * MIN);
	});

	it('repasse vite quand un booster offert attend', async () => {
		const { computeNextRun } = await loadBot();
		const acct = account({ account: { grants: { golden: 1 } } });
		expect(computeNextRun(acct, NOW)).toBe(NOW + 5 * MIN);
	});

	it('ignore un cadeau épuisé', async () => {
		const { computeNextRun } = await loadBot();
		const acct = account({ account: { grants: { golden: 0 } } });
		expect(computeNextRun(acct, NOW)).toBe(NOW + 90 * MIN);
	});
});
