import { json, error } from '@sveltejs/kit';
import { state, save, log, snapshot } from '#lib/server/state.js';
import { seal } from '#lib/server/crypto.js';
import { validateToken, KyaraError } from '#lib/server/kyara.js';
import { applyMe, onTokenSaved, onTokenCleared } from '#lib/server/bot.js';

/** Enregistre la clé Kyara (validée auprès de l'API avant stockage chiffré). */
export async function POST({ request }) {
	const body = await request.json().catch(() => ({}));
	const token = String(body.token ?? '').trim();

	if (!/^[a-zA-Z0-9._-]{16,256}$/.test(token)) {
		throw error(400, 'Format de clé invalide');
	}

	let me;
	try {
		me = await validateToken(token);
	} catch (e) {
		if (e instanceof KyaraError && e.status === 401) {
			throw error(401, 'Clé refusée par Kyara (401). Vérifie que tu es connecté sur kyara.games.');
		}
		throw error(502, e?.message ?? 'Impossible de vérifier la clé');
	}

	if (me?.discord == null && me?.pseudo == null) {
		throw error(400, 'Cette clé ne correspond pas à un compte Kyara.');
	}

	state.token = seal(token);
	state.tokenSetAt = new Date().toISOString();
	applyMe(me);
	save();
	log('success', `Clé enregistrée pour ${me.pseudo ?? 'ton compte'} (${me.discord?.username ?? 'discord'}).`);
	onTokenSaved();

	return json(snapshot(), { headers: { 'cache-control': 'no-store' } });
}

/** Oublie la clé et met le bot en pause. */
export async function DELETE() {
	state.token = null;
	state.tokenSetAt = null;
	save();
	log('warn', 'Clé supprimée.');
	onTokenCleared();
	return json(snapshot(), { headers: { 'cache-control': 'no-store' } });
}
