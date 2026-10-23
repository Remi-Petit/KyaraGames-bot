import { authMode, publicUser } from '#lib/server/session.js';

/**
 * Données communes à toutes les pages : qui est connecté, et si le dashboard
 * tourne en mode ouvert (aucun utilisateur configuré). La barre de navigation
 * s'en sert pour afficher « Administration » aux seuls administrateurs.
 */
export function load({ locals }) {
	const mode = authMode();
	return {
		me: publicUser(locals.user),
		authMode: mode
	};
}
