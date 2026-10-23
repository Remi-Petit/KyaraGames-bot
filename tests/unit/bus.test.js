import { describe, expect, it, vi } from 'vitest';
import { publish, subscribe, subscriberCount } from '../../src/lib/server/bus.js';

describe('bus d’événements', () => {
	it('notifie tous les abonnés et respecte le désabonnement', () => {
		const calls = [];

		const offA = subscribe(() => calls.push('a'));
		const offB = subscribe(() => calls.push('b'));
		expect(subscriberCount()).toBe(2);

		publish();
		expect(calls).toEqual(['a', 'b']);

		offA();
		expect(subscriberCount()).toBe(1);
		publish();
		expect(calls).toEqual(['a', 'b', 'b']);

		offB();
		expect(subscriberCount()).toBe(0);
		publish();
		expect(calls).toEqual(['a', 'b', 'b']);
	});

	it('isole un abonné qui lève une exception', () => {
		const healthy = vi.fn();
		const offBad = subscribe(() => {
			throw new Error('boom');
		});
		const offGood = subscribe(healthy);

		expect(() => publish()).not.toThrow();
		expect(healthy).toHaveBeenCalledTimes(1);

		offBad();
		offGood();
	});
});
