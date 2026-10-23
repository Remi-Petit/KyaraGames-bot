import { authMode, publicUser } from '#lib/server/session.js';
import pkg from '../../package.json';

/**
 * Données communes à toutes les pages : qui est connecté, la version du projet,
 * et si le dashboard tourne en mode ouvert (aucun utilisateur configuré). La
 * barre de navigation s'en sert pour afficher « Administration » aux seuls
 * administrateurs.
 */
export function load({ locals }) {
	const mode = authMode();
	return {
		me: publicUser(locals.user),
		authMode: mode,
		version: pkg.version
	};
}
