import { vi } from 'vitest';

// Aucun test ne doit toucher le vrai kyara.games : par défaut, fetch échoue.
// Les tests d'intégration remplacent cette valeur par un faux serveur.
vi.stubGlobal(
	'fetch',
	vi.fn(async () => {
		throw new Error('réseau désactivé pendant les tests');
	})
);
