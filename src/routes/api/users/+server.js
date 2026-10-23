import { json, error } from '@sveltejs/kit';
import { db, save } from '#lib/server/state.js';
import {
	authMode,
	publicUser,
	createUser,
	countAccountsOf,
	COOKIE,
	makeSessionCookie
} from '#lib/server/session.js';

/** En mode ouvert (aucun utilisateur), tout est permis : c'est ainsi qu'on crée le premier admin. */
function requireAdmin(locals) {
	if (authMode() === 'open') return null;
	if (locals.user?.role !== 'admin') throw error(403, 'Réservé à l’administrateur.');
	return locals.user;
}

export function GET({ locals }) {
	requireAdmin(locals);
	return json(
		{
			mode: authMode(),
			users: db.users.map((u) => ({ ...publicUser(u), accounts: countAccountsOf(u.id) }))
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
}

export async function POST({ request, locals, cookies }) {
	requireAdmin(locals);
	const body = await request.json().catch(() => ({}));

	let created;
	try {
		created = createUser({
			username: body.username,
			password: body.password || undefined,
			role: body.role
		});
	} catch (e) {
		throw error(400, e.message);
	}

	// Premier utilisateur créé depuis l'interface : on ouvre directement sa session.
	const firstUser = db.users.length === 1;
	if (firstUser) {
		for (const account of db.accounts) {
			if (!account.ownerId) account.ownerId = created.user.id;
		}
		save();
		cookies.set(COOKIE, makeSessionCookie(created.user), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});
	}

	return json({
		user: publicUser(created.user),
		// Renvoyé une seule fois : à transmettre à la personne concernée.
		password: created.password,
		loggedIn: firstUser
	});
}
