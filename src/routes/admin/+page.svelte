<script>
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let errorMessage = $state(null);
	let generated = $state(null);
	let busy = $state(null);
	let newUsername = $state('');
	let newRole = $state('member');

	const me = $derived(data.me);
	const users = $derived(data.users ?? []);
	const accounts = $derived(data.accounts ?? []);

	async function call(path, method, body) {
		const res = await fetch(path, {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const payload = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(payload.message ?? payload.error ?? `Erreur ${res.status}`);
		return payload;
	}

	async function guard(action, fn) {
		busy = action;
		errorMessage = null;
		generated = null;
		try {
			await fn();
		} catch (e) {
			errorMessage = e.message;
		} finally {
			busy = null;
		}
	}

	function createUser(event) {
		event.preventDefault();
		return guard('create', async () => {
			const body = await call('/api/users', 'POST', { username: newUsername, role: newRole });
			newUsername = '';
			if (body.loggedIn) {
				// Premier compte : la session est ouverte et les comptes existants lui sont rattachés.
				location.reload();
				return;
			}
			generated = { username: body.user.username, password: body.password };
			await invalidateAll();
		});
	}

	function resetPassword(user) {
		return guard('reset-' + user.id, async () => {
			const body = await call(`/api/users/${user.id}`, 'PATCH', { resetPassword: true });
			generated = { username: user.username, password: body.password };
			await invalidateAll();
		});
	}

	function setRole(user, role) {
		return guard('role-' + user.id, async () => {
			await call(`/api/users/${user.id}`, 'PATCH', { role });
			await invalidateAll();
		});
	}

	function removeUser(user) {
		if (!confirm(`Supprimer l'utilisateur ${user.username} ?`)) return;
		return guard('delete-' + user.id, async () => {
			await call(`/api/users/${user.id}`, 'DELETE');
			await invalidateAll();
		});
	}

	function stateOf(a) {
		if (!a.tokenSet) return { label: 'non connecté', tone: 'warn' };
		if (a.tokenInvalid) return { label: 'clé refusée', tone: 'warn' };
		if (!a.running) return { label: 'en pause', tone: 'warn' };
		if (a.busy) return { label: 'en cours', tone: 'ok' };
		return { label: 'en marche', tone: 'ok' };
	}
</script>

<svelte:head><title>Kyara — Administration</title></svelte:head>

<div class="wrap">
	<div class="page-head">
		<h1>Administration</h1>
		<p class="note">
			Chaque personne gère <strong>ses propres comptes Kyara</strong> : elle ne voit ni les tiens ni
			tes clés, et ses actions ne touchent que ses comptes. Le bot tourne pour tout le monde.
		</p>
	</div>

	{#if generated}
		<div class="flash ok">
			Mot de passe pour <strong>{generated.username}</strong> :
			<code>{generated.password}</code> — affiché une seule fois.
		</div>
	{/if}
	{#if errorMessage}<p class="err">{errorMessage}</p>{/if}

	<section class="panel">
		<div class="panel-head">
			<h2>Utilisateurs</h2>
			<span class="tag">{users.length}</span>
		</div>

		<div class="users-list">
			{#each users as u (u.id)}
				<div class="user-row">
					<div>
						<strong>{u.username}</strong>
						{#if u.id === me?.id}<span class="tag ok">vous</span>{/if}
						<span class="user-meta">{u.accounts} compte(s) Kyara</span>
					</div>
					<div class="user-actions">
						<select
							value={u.role}
							disabled={busy !== null || u.id === me?.id}
							onchange={(e) => setRole(u, e.currentTarget.value)}
							title={u.id === me?.id ? 'Impossible de changer son propre rôle' : 'Changer le rôle'}
						>
							<option value="member">membre</option>
							<option value="admin">administrateur</option>
						</select>
						<button class="link" onclick={() => resetPassword(u)} disabled={busy !== null}>
							Réinitialiser
						</button>
						{#if u.id !== me?.id}
							<button class="link danger" onclick={() => removeUser(u)} disabled={busy !== null}>
								Supprimer
							</button>
						{/if}
					</div>
				</div>
			{:else}
				<p class="empty">
					Aucun utilisateur : le tableau de bord est en accès libre. Crée le premier compte pour
					activer la connexion.
				</p>
			{/each}
		</div>

		<form class="token-form" onsubmit={createUser}>
			<input
				type="text"
				bind:value={newUsername}
				placeholder="Nom du nouvel utilisateur"
				autocomplete="off"
			/>
			<select bind:value={newRole} disabled={busy !== null}>
				<option value="member">membre</option>
				<option value="admin">administrateur</option>
			</select>
			<button class="primary" type="submit" disabled={busy !== null || newUsername.trim().length < 3}>
				{busy === 'create' ? 'Création…' : 'Créer'}
			</button>
		</form>
		<p class="note small">
			Le mot de passe est généré côté serveur et n'est affiché qu'une fois. La personne peut le
			changer depuis son propre écran, ou tu peux le réinitialiser ici.
		</p>
	</section>

	<section class="panel accounts-panel">
		<div class="panel-head">
			<h2>Comptes Kyara</h2>
			<span class="tag">{accounts.length}</span>
		</div>

		<div class="users-list">
			{#each accounts as a (a.id)}
				{@const state = stateOf(a)}
				<div class="user-row">
					<div>
						<strong>{a.pseudo ?? 'Compte sans relevé'}</strong>
						<span class="tag">{a.owner ?? 'sans propriétaire'}</span>
						<span class="user-meta">{a.freePacks}/{a.freePacksMax} en réserve</span>
					</div>
					<span class="tag {state.tone === 'ok' ? 'ok' : 'warn'}">{state.label}</span>
				</div>
			{:else}
				<p class="empty">Aucun compte rattaché pour l'instant.</p>
			{/each}
		</div>

		<p class="note small">
			Vue d'ensemble en lecture seule — le pilotage de chaque compte reste sur le
			<a href="/">dashboard</a>.
		</p>
	</section>

	<footer>
		<span>Kyara Bot · non-officiel</span>
		<span>Les actions passent par l'API du site avec la session de chaque propriétaire.</span>
	</footer>
</div>

<style>
	.page-head {
		margin: 8px 0 18px;
	}
	h1 {
		margin: 0;
		font-size: 22px;
		letter-spacing: -0.01em;
	}
	.accounts-panel {
		margin-top: 16px;
	}
	.user-actions select {
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 8px;
		color: var(--text);
		font-size: 11.5px;
		padding: 4px 8px;
	}
	.user-actions select:disabled {
		opacity: 0.5;
	}
	.user-row .tag {
		margin-left: 6px;
	}
</style>
