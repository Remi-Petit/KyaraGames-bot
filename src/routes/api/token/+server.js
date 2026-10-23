import { json, error } from '@sveltejs/kit';
import {
	snapshot,
	upsertAccount,
	removeAccount,
	findAccount,
	profileFromMe,
	MAX_ACCOUNTS,
	db,
	log
} from '#lib/server/state.js';
import { seal } from '#lib/server/crypto.js';
import { validateToken, KyaraError } from '#lib/server/kyara.js';
import { onTokenSaved, onTokenRemoved } from '#lib/server/bot.js';

/**
 * Ajoute un compte ou remplace la clé d'un compte existant.
 * L'identifiant est `me.id` (UUID Kyara) — la seule clé stable entre les sessions.
 */
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

	if (!me?.id) {
		throw error(400, 'Cette clé ne correspond pas à un compte Kyara.');
	}

	const existing = findAccount(me.id);
	if (!existing && db.accounts.length >= MAX_ACCOUNTS) {
		throw error(400, `Maximum ${MAX_ACCOUNTS} comptes gérés.`);
	}

	upsertAccount({
		id: me.id,
		token: seal(token),
		tokenSetAt: new Date().toISOString(),
		tokenInvalid: false,
		account: profileFromMe(me)
	});

	const account = findAccount(me.id);
	log(
		account,
		'success',
		existing
			? 'Nouvelle clé enregistrée.'
			: `Compte ajouté (${me.pseudo ?? me.discord?.username ?? 'inconnu'}).`
	);
	onTokenSaved(me.id);

	return json(snapshot(me.id), { headers: { 'cache-control': 'no-store' } });
}

/** Supprime un compte (et sa clé). */
export async function DELETE({ request, url }) {
	let body = {};
	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const id = body.accountId ?? url.searchParams.get('account');
	if (!id) throw error(400, 'accountId requis');

	const account = findAccount(id);
	if (!account) throw error(404, 'Compte inconnu');

	onTokenRemoved(id);
	removeAccount(id);

	return json(snapshot(), { headers: { 'cache-control': 'no-store' } });
}
