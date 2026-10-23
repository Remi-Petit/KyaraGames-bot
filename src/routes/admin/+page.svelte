<script>
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let errorMessage = $state(null);
	let generated = $state(null);
	let busy = $state(null);
	let newUsername = $state('');
	let newRole = $state('member');
	let tab = $state('users');
	let notifyFlash = $state(null);
	let notifyUserId = $state(null);
	let nf = $state({
		enabled: false,
		url: 'https://ntfy.sh',
		topic: '',
		token: '',
		onRare: true,
		onErrors: true
	});

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
		notifyFlash = null;
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

	/* ---------------- notifications ---------------- */

	function loadNotifyForm(u) {
		nf = {
			enabled: u.notify.enabled,
			url: u.notify.url,
			topic: u.notify.topic,
			token: '',
			onRare: u.notify.onRare,
			onErrors: u.notify.onErrors
		};
	}

	let notifyReady = false;
	// Premier rendu avec des utilisateurs : on ouvre le formulaire sur soi-même.
	$effect(() => {
		if (notifyReady) return;
		const u = users.find((x) => x.id === me?.id) ?? users[0];
		if (!u) return;
		notifyReady = true;
		notifyUserId = u.id;
		loadNotifyForm(u);
	});

	function pickNotifyUser(id) {
		notifyUserId = id;
		const u = users.find((x) => x.id === id);
		if (u) loadNotifyForm(u);
	}

	function saveNotify(event) {
		event.preventDefault();
		return guard('notify-save', async () => {
			await call(`/api/users/${notifyUserId}`, 'PATCH', { notify: { ...nf } });
			nf.token = '';
			notifyFlash = 'Réglages enregistrés.';
			await invalidateAll();
		});
	}

	function sendTest() {
		return guard('notify-test', async () => {
			await call(`/api/users/${notifyUserId}`, 'POST');
			notifyFlash = 'Notification de test envoyée.';
		});
	}

	const notifyTarget = $derived(users.find((u) => u.id === notifyUserId) ?? null);
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

	<div class="tabs" role="tablist">
		<button
			class="tab"
			class:active={tab === 'users'}
			role="tab"
			aria-selected={tab === 'users'}
			onclick={() => (tab = 'users')}
		>
			Utilisateurs
		</button>
		<button
			class="tab"
			class:active={tab === 'notifications'}
			role="tab"
			aria-selected={tab === 'notifications'}
			onclick={() => (tab = 'notifications')}
		>
			Notifications
		</button>
	</div>

	{#if tab === 'users'}
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
	{/if}

	{#if tab === 'notifications'}
		<section class="panel">
			<div class="panel-head">
				<h2>Notifications</h2>
				<span class="tag">{notifyTarget?.notify.enabled && notifyTarget?.notify.topic ? 'actives' : 'inactives'}</span>
			</div>

			<p class="note">
				Envoi via <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> : abonne-toi
				au topic dans l'application mobile, et le bot t'y pousse les butins qui comptent.
				Chaque utilisateur a <strong>sa propre</strong> configuration.
			</p>

			{#if !users.length}
				<p class="empty">
					Crée d'abord un utilisateur dans l'onglet Utilisateurs : les notifications sont
					rattachées à un compte.
				</p>
			{:else}
				{#if notifyFlash}<div class="flash ok">{notifyFlash}</div>{/if}

				<form class="notify-form" onsubmit={saveNotify}>
					<label class="field">
						<span>Utilisateur</span>
						<select
							value={notifyUserId ?? ''}
							onchange={(e) => pickNotifyUser(e.currentTarget.value)}
						>
							{#each users as u (u.id)}
								<option value={u.id}>{u.username}{u.id === me?.id ? ' (vous)' : ''}</option>
							{/each}
						</select>
					</label>

					<label class="switch">
						<input type="checkbox" bind:checked={nf.enabled} />
						<span>Activer les notifications</span>
					</label>

					<div class="fields">
						<label class="field">
							<span>Serveur</span>
							<input type="url" bind:value={nf.url} placeholder="https://ntfy.sh" />
						</label>
						<label class="field">
							<span>Topic</span>
							<input
								type="text"
								bind:value={nf.topic}
								placeholder="kyara-bot-remi"
								autocomplete="off"
							/>
						</label>
					</div>

					<label class="field">
						<span>Jeton (facultatif)</span>
						<input
							type="password"
							bind:value={nf.token}
							placeholder={notifyTarget?.notify.tokenSet ? 'inchangé' : 'bearer token'}
							autocomplete="off"
						/>
					</label>

					<div class="switches">
						<label class="switch">
							<input type="checkbox" bind:checked={nf.onRare} />
							<span>Légendaire ou mythique</span>
						</label>
						<label class="switch">
							<input type="checkbox" bind:checked={nf.onErrors} />
							<span>Erreurs (clé refusée, réseau)</span>
						</label>
					</div>

					<div class="buttons">
						<button class="primary" type="submit" disabled={busy !== null}>
							{busy === 'notify-save' ? 'Enregistrement…' : 'Enregistrer'}
						</button>
						<button
							class="ghost"
							type="button"
							onclick={sendTest}
							disabled={busy !== null}
						>
							{busy === 'notify-test' ? 'Envoi…' : 'Envoyer un test'}
						</button>
					</div>
					<p class="note small">
						Le test utilise la configuration <strong>déjà enregistrée</strong> : enregistre d'abord
						après une modification. Le jeton est chiffré et n'est jamais renvoyé au navigateur.
					</p>
				</form>
			{/if}
		</section>
	{/if}

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

	.tabs {
		display: inline-flex;
		gap: 4px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 4px;
		margin-bottom: 16px;
	}
	.tab {
		background: none;
		border: 0;
		color: var(--muted);
		font-size: 12.5px;
		font-weight: 600;
		padding: 7px 16px;
		border-radius: 999px;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.active {
		background: var(--gold);
		color: #191307;
	}

	.notify-form {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.field {
		display: grid;
		gap: 6px;
		margin-top: 12px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	.field input,
	.field select {
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 9px 11px;
		color: var(--text);
		font-family: var(--mono);
		font-size: 12px;
	}
	.buttons {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 18px;
	}
</style>
