import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, freshStore } from '../helpers.js';

const dirs = [];

afterEach(() => {
	dirs.forEach(cleanup);
	dirs.length = 0;
});

async function store() {
	const loaded = await freshStore();
	dirs.push(loaded.dir);
	return loaded;
}

describe('mots de passe', () => {
	it('hache avec un sel unique et vérifie correctement', async () => {
		const { crypto } = await store();

		const a = crypto.hashPassword('motdepasse1');
		const b = crypto.hashPassword('motdepasse1');

		expect(a.salt).not.toBe(b.salt);
		expect(a.hash).not.toBe(b.hash);
		expect(crypto.verifyPassword(a, 'motdepasse1')).toBe(true);
		expect(crypto.verifyPassword(a, 'motdepasse2')).toBe(false);
	});

	it('refuse un enregistrement vide ou corrompu', async () => {
		const { crypto } = await store();

		expect(crypto.verifyPassword({}, 'x')).toBe(false);
		expect(crypto.verifyPassword(null, 'x')).toBe(false);
		expect(crypto.verifyPassword({ salt: 'abc', hash: 'zz' }, 'x')).toBe(false);
		expect(crypto.verifyPassword({ salt: 'abc', hash: '00' }, '')).toBe(false);
	});

	it('génère des mots de passe longs, variés et sans caractères ambigus', async () => {
		const { crypto } = await store();

		const generated = new Set(Array.from({ length: 50 }, () => crypto.randomPassword()));

		expect(generated.size).toBe(50);
		for (const password of generated) {
			expect(password).toHaveLength(18);
			expect(password).not.toMatch(/[0O1lI]/);
		}
	});
});
