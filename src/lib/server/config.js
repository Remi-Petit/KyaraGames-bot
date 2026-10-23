import fs from 'node:fs';
import path from 'node:path';

/** Chargement minimal de .env (évite une dépendance supplémentaire). */
function loadDotEnv() {
	const file = path.resolve(process.cwd(), '.env');
	const out = {};
	try {
		for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
			if (!line || line.trimStart().startsWith('#')) continue;
			const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
			if (!m) continue;
			let value = m[2];
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			out[m[1]] = value;
		}
	} catch {
		/* pas de .env : valeurs par défaut */
	}
	return out;
}

const dotenv = loadDotEnv();
const read = (key) => process.env[key] ?? dotenv[key] ?? '';

export const KYARA_BASE = 'https://kyara.games/api';

export const DATA_DIR = read('KYARA_DATA_DIR')
	? path.resolve(read('KYARA_DATA_DIR'))
	: path.resolve(process.cwd(), '.data');

export const DASHBOARD_PASSWORD = read('DASHBOARD_PASSWORD');

export function ensureDataDir() {
	fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function dataFile(name) {
	ensureDataDir();
	return path.join(DATA_DIR, name);
}
