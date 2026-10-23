import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.js'],
		setupFiles: ['./tests/setup.js'],
		restoreMocks: true,
		// Chaque test réimporte les modules avec un dossier de données isolé :
		// pas d'exécution parallèle pour éviter de partager process.env.
		fileParallelism: false,
		sequence: { concurrent: false }
	}
});
