import { json, error } from '@sveltejs/kit';
import { db, save } from '#lib/server/state.js';
import { authMode, publicUser, setUserPassword, deleteUser, countAccountsOf } from '#lib/server/session.js';

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

/** Change le rôle et/ou réinitialise le mot de passe. */
export async function PATCH({ params, request, locals }) {
	const admin = requireAdmin(locals);
	const body = await request.json().catch(() => ({}));
	const user = findUser(params.id);

	if (body.role && user.id === admin?.id && body.role !== 'admin') {
		throw error(400, 'Vous ne pouvez pas retirer votre propre rôle administrateur.');
	}
	if (body.role) user.role = body.role === 'admin' ? 'admin' : 'member';

	let password;
	if (body.resetPassword) password = setUserPassword(user);
	else save();

	return json({ user: publicUser(user), password });
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
