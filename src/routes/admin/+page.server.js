import { error } from '@sveltejs/kit';
import { db, accountSummary, visibleAccounts } from '#lib/server/state.js';
import { authMode, publicUser, countAccountsOf } from '#lib/server/session.js';

/**
 * Page d'administration : réservée aux administrateurs.
 * En mode ouvert (aucun utilisateur), elle reste accessible — c'est là qu'on
 * crée le premier compte.
 */
export function load({ locals }) {
	const open = authMode() === 'open';
	if (!open && locals.user?.role !== 'admin') {
		throw error(403, 'Réservé à l’administrateur.');
	}

	return {
		open,
		users: db.users.map((u) => ({ ...publicUser(u), accounts: countAccountsOf(u.id) })),
		accounts: visibleAccounts(locals.user).map(accountSummary)
	};
}
