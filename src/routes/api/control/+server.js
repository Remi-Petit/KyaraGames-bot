import { json, error } from '@sveltejs/kit';
import { findAccount, db, save, snapshot, log } from '#lib/server/state.js';
import { runnerFor } from '#lib/server/bot.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));

export async function POST({ request }) {
	const body = await request.json().catch(() => ({}));
	const account = findAccount(body.accountId);
	if (!account) throw error(404, 'Compte inconnu');

	const runner = runnerFor(account.id);
	const action = body.action;

	if (action === 'pause') {
		runner.pause();
	} else if (action === 'resume') {
		runner.resume();
	} else if (action === 'sync') {
		try {
			await runner.sync();
		} catch (e) {
			throw error(502, e?.message ?? 'Synchronisation impossible');
		}
	} else if (action === 'run') {
		try {
			await runner.runNow('manuel');
		} catch (e) {
			throw error(400, e?.message ?? 'Exécution impossible');
		}
	} else if (action === 'settings') {
		const s = body.settings ?? {};
		if (s.pollMinutes !== undefined) account.settings.pollMinutes = clamp(s.pollMinutes, 5, 1440);
		if (s.maxPerRun !== undefined) account.settings.maxPerRun = clamp(s.maxPerRun, 1, 10);
		if (s.dailyPack !== undefined) account.settings.dailyPack = Boolean(s.dailyPack);
		if (s.smart !== undefined) account.settings.smart = Boolean(s.smart);
		if (s.humanDelay !== undefined) account.settings.humanDelay = Boolean(s.humanDelay);
		if (s.types !== undefined) {
			const known = new Set((db.meta.packs || []).filter((p) => p.free).map((p) => p.id));
			const list = Array.isArray(s.types) ? s.types.filter((id) => known.has(id)) : [];
			account.settings.types = list.length ? list : null;
		}
		save();
		log(account, 'info', 'Réglages enregistrés.');
		runner.schedule();
	} else if (action === 'clear-logs') {
		account.logs = [];
		save();
	} else {
		throw error(400, 'Action inconnue');
	}

	return json(snapshot(account.id), { headers: { 'cache-control': 'no-store' } });
}
