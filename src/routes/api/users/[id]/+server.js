import { json, error } from '@sveltejs/kit';
import { db, save } from '#lib/server/state.js';
import { authMode, publicUser, setUserPassword, deleteUser, countAccountsOf } from '#lib/server/session.js';
import { seal } from '#lib/server/crypto.js';
import { notifyConfig } from '#lib/server/notify.js';
import { sendNtfy } from '#lib/server/ntfy.js';

function requireAdmin(locals) {
	if (authMode() === 'open') return null;
	if (locals.user?.role !== 'admin') throw error(403, 'Réservé à l’administrateur.');
	return locals.user;
}

function findUser(id) {
	const user = db.users.find((u) => u.id === id);
	if (!user) throw error(404, 'Utilisateur inconnu.');
	return user;
}

/** Change le rôle, réinitialise le mot de passe et/ou règle les notifications. */
export async function PATCH({ params, request, locals }) {
	const admin = requireAdmin(locals);
	const body = await request.json().catch(() => ({}));
	const user = findUser(params.id);

	if (body.role && user.id === admin?.id && body.role !== 'admin') {
		throw error(400, 'Vous ne pouvez pas retirer votre propre rôle administrateur.');
	}
	if (body.role) user.role = body.role === 'admin' ? 'admin' : 'member';

	if (body.notify && typeof body.notify === 'object') {
		const input = body.notify;
		const n = user.notify;
		if (input.enabled !== undefined) n.enabled = Boolean(input.enabled);
		if (input.url !== undefined) n.url = String(input.url || 'https://ntfy.sh').trim();
		if (input.topic !== undefined) n.topic = String(input.topic).trim();
		if (input.onRare !== undefined) n.onRare = Boolean(input.onRare);
		if (input.onErrors !== undefined) n.onErrors = Boolean(input.onErrors);
		// `null` efface le jeton, une chaîne vide le laisse inchangé (le champ est masqué).
		if (input.token === null) n.token = null;
		else if (typeof input.token === 'string' && input.token.trim()) n.token = seal(input.token.trim());
	}

	let password;
	if (body.resetPassword) password = setUserPassword(user);
	else save();

	return json({ user: publicUser(user), password });
}

/** Envoie une notification de test avec la configuration enregistrée. */
export async function POST({ params, locals }) {
	requireAdmin(locals);
	const user = findUser(params.id);
	const cfg = notifyConfig(user);
	if (!cfg) throw error(400, 'Notifications désactivées ou topic manquant.');

	const sent = await sendNtfy({
		...cfg,
		title: 'Kyara — test',
		message: `Notification de test pour ${user.username}. Si tu lis ceci, c'est branché.`,
		priority: 3,
		tags: ['white_check_mark']
	});
	if (!sent.ok) throw error(400, `Envoi impossible : ${sent.reason}`);
	return json({ ok: true });
}

export async function DELETE({ params, locals }) {
	const admin = requireAdmin(locals);
	const user = findUser(params.id);

	if (user.id === admin?.id) {
		throw error(400, 'Impossible de supprimer votre propre compte.');
	}

	const owned = countAccountsOf(user.id);
	if (owned > 0) {
		throw error(
			400,
			`${owned} compte(s) Kyara rattaché(s) à ${user.username} — supprimez-les d’abord.`
		);
	}

	deleteUser(user);
	return json({ ok: true });
}
