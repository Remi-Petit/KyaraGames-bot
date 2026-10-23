import { describe, expect, it } from 'vitest';
import { nextFreeInMs } from '../../src/lib/nextFree.js';

const REGEN = 600_000; // 10 min
const NOW = Date.parse('2026-10-23T17:05:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

describe('nextFreeInMs', () => {
	it('renvoie simplement l’échéance tant qu’elle est dans le futur', () => {
		expect(nextFreeInMs(iso(NOW + 4 * 60_000), REGEN, 2, 10, NOW)).toBe(4 * 60_000);
	});

	it('roule l’échéance d’une régénération quand elle vient de passer', () => {
		// Le booster vient d'arriver : le suivant est dans 10 min, pas « maintenant ».
		expect(nextFreeInMs(iso(NOW - 1_000), REGEN, 3, 10, NOW)).toBe(REGEN - 1_000);
	});

	it('rattrape plusieurs régénérations manquées', () => {
		// 25 min après l'ancre : 2 boosters déjà écoulés, le 3e dans 5 min.
		expect(nextFreeInMs(iso(NOW - 25 * 60_000), REGEN, 4, 10, NOW)).toBe(5 * 60_000);
	});

	it('pile sur une frontière de régénération', () => {
		expect(nextFreeInMs(iso(NOW - REGEN), REGEN, 3, 10, NOW)).toBe(REGEN);
	});

	it('ne renvoie rien quand la réserve est pleine', () => {
		expect(nextFreeInMs(iso(NOW - 60_000), REGEN, 10, 10, NOW)).toBeNull();
	});

	it('tolère une ancre absente ou invalide', () => {
		expect(nextFreeInMs(null, REGEN, 2, 10, NOW)).toBeNull();
		expect(nextFreeInMs('n’importe quoi', REGEN, 2, 10, NOW)).toBeNull();
	});

	it('retombe sur l’échéance brute sans durée de régénération connue', () => {
		expect(nextFreeInMs(iso(NOW + 60_000), null, 2, 10, NOW)).toBe(60_000);
	});
});
