import { json, error } from '@sveltejs/kit';
import { state, save, snapshot, log } from '#lib/server/state.js';
import { pause, resume, runNow, scheduleNext } from '#lib/server/bot.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));

export async function POST({ request }) {
	const body = await request.json().catch(() => ({}));
	const action = body.action;

	if (action === 'pause') pause();
	else if (action === 'resume') resume();
	else if (action === 'run') {
		try {
			await runNow('manuel');
		} catch (e) {
			throw error(400, e?.message ?? 'Exécution impossible');
		}
	} else if (action === 'settings') {
		const s = body.settings ?? {};
		if (s.pollMinutes !== undefined) state.settings.pollMinutes = clamp(s.pollMinutes, 5, 1440);
		if (s.maxPerRun !== undefined) state.settings.maxPerRun = clamp(s.maxPerRun, 1, 10);
		if (s.dailyPack !== undefined) state.settings.dailyPack = Boolean(s.dailyPack);
		if (s.smart !== undefined) state.settings.smart = Boolean(s.smart);
		if (s.humanDelay !== undefined) state.settings.humanDelay = Boolean(s.humanDelay);
		if (s.types !== undefined) {
			const known = new Set((state.meta.packs || []).filter((p) => p.free).map((p) => p.id));
			const list = Array.isArray(s.types) ? s.types.filter((id) => known.has(id)) : [];
			state.settings.types = list.length ? list : null;
		}
		save();
		log('info', 'Réglages enregistrés.');
		scheduleNext();
	} else if (action === 'clear-logs') {
		state.logs = [];
		save();
	} else {
		throw error(400, 'Action inconnue');
	}

	return json(snapshot(), { headers: { 'cache-control': 'no-store' } });
}
