/**
 * Bus d'événements minimal : les routes SSE s'abonnent, `state.save()` publie.
 * Aucune dépendance, aucun couplage avec la logique métier.
 */

/** @type {Set<() => void>} */
const subscribers = new Set();

/** @param {() => void} listener @returns {() => void} désabonnement */
export function subscribe(listener) {
	subscribers.add(listener);
	return () => subscribers.delete(listener);
}

export function publish() {
	for (const listener of [...subscribers]) {
		try {
			listener();
		} catch {
			// Un abonné défaillant ne doit pas casser les autres (ni le bot).
		}
	}
}

export function subscriberCount() {
	return subscribers.size;
}
