<script>
	import { onMount } from 'svelte';

	let { data } = $props();

	let raw = $state(data.snapshot);
	let now = $state(data.snapshot.now ?? Date.now());
	let acctId = $state(data.snapshot.selected?.id ?? null);
	let pending = $state(null);
	let flash = $state(null);
	let dirty = $state(false);
	let adding = $state(false);
	let me = $state(data.me);
	let authMode = data.authMode;
	let users = $state([]);
	let usersError = $state(null);
	let newUsername = $state('');
	let newRole = $state('member');
	let generated = $state(null);
	let settings = $state({ ...(data.snapshot.selected?.settings ?? {}) });
	let tokenInput = $state('');
	let tokenVisible = $state(false);
	let tokenBusy = $state(false);

	// Vue aplatie : les sections du dashboard continuent de lire snap.account / snap.bot / ...
	const snap = $derived({
		meta: raw.meta,
		accounts: raw.accounts,
		maxAccounts: raw.maxAccounts,
		...(raw.selected ?? {})
	});

	const RARITY = {
		C: { label: 'Commune', color: '#8b93a7' },
		U: { label: 'Peu commune', color: '#4ade80' },
		R: { label: 'Rare', color: '#60a5fa' },
		E: { label: 'Épique', color: '#a78bfa' },
		L: { label: 'Légendaire', color: '#fbbf24' },
		M: { label: 'Mythique', color: '#f472b6' }
	};
	const ORDER = ['C', 'U', 'R', 'E', 'L', 'M'];

	async function refresh() {
		try {
			const query = acctId ? `?account=${encodeURIComponent(acctId)}` : '';
			const res = await fetch('/api/state' + query, { cache: 'no-store' });
			if (res.ok) {
				raw = await res.json();
				if (raw.selected?.id) acctId = raw.selected.id;
			}
		} catch {
			/* hors ligne : on garde le dernier état */
		}
	}

	async function selectAccount(id) {
		if (id === acctId) return;
		acctId = id;
		dirty = false;
		adding = false;
		tokenInput = '';
		flash = null;
		await refresh();
	}

	onMount(() => {
		const poll = setInterval(refresh, 2000);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	$effect(() => {
		if (!dirty && snap.settings) Object.assign(settings, { ...snap.settings });
	});

	const freePacks = $derived(snap.account?.freePacks ?? 0);
	const cap = $derived(snap.account?.freePacksMax ?? snap.meta?.freePacksMax ?? 10);
	const checkedAgoMs = $derived(snap.checkedAt ? Math.max(0, now - Date.parse(snap.checkedAt)) : null);
	// La réserve se régénère seule entre deux relevés : on projette depuis nextFreeAt
	// (l'ancre exacte donnée par Kyara), pas depuis l'heure du relevé.
	const estFree = $derived(
		(() => {
			const regen = snap.meta?.regenMs;
			const nextAt = snap.account?.nextFreeAt ? Date.parse(snap.account.nextFreeAt) : null;
			if (!regen || !Number.isFinite(nextAt) || now < nextAt) return freePacks;
			return Math.min(cap, freePacks + 1 + Math.floor((now - nextAt) / regen));
		})()
	);
	const pctEst = $derived(cap > 0 ? Math.min(100, (estFree / cap) * 100) : 0);
	const nextFreeMs = $derived(
		snap.account?.nextFreeAt ? Date.parse(snap.account.nextFreeAt) - now : null
	);
	const nextRunMs = $derived(snap.bot?.nextRunAt ? Date.parse(snap.bot.nextRunAt) - now : null);
	const status = $derived(
		snap.tokenInvalid
			? { label: 'Clé à renouveler', tone: 'danger' }
			: !snap.tokenSet
				? { label: 'Non connecté', tone: 'muted' }
				: snap.bot.busy
					? { label: 'En cours…', tone: 'busy' }
					: snap.bot.running
						? { label: 'En marche', tone: 'ok' }
						: { label: 'En pause', tone: 'warn' }
	);
	const totalCards = $derived(ORDER.reduce((sum, r) => sum + (snap.stats?.byRarity?.[r] ?? 0), 0));
	const freeTypes = $derived(snap.meta?.freeTypes ?? []);

	function fmtDur(ms) {
		if (ms == null || !Number.isFinite(ms)) return '—';
		if (ms <= 0) return 'maintenant';
		const s = Math.floor(ms / 1000);
		const m = Math.floor(s / 60);
		const h = Math.floor(m / 60);
		if (h >= 1) return `${h} h ${String(m % 60).padStart(2, '0')}`;
		if (m >= 1) return `${m} min ${String(s % 60).padStart(2, '0')}`;
		return `${s} s`;
	}
	function fmtTime(iso) {
		if (!iso) return '—';
		return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}
	function fmtDateTime(iso) {
		if (!iso) return 'jamais';
		return new Date(iso).toLocaleString('fr-FR', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function send(path, body, method = 'POST') {
		const res = await fetch(path, {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const payload = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(payload.message ?? payload.error ?? `Erreur ${res.status}`);
		return payload;
	}

	async function act(action) {
		pending = action;
		flash = null;
		try {
			raw = await send('/api/control', { action, accountId: snap.id });
		} catch (e) {
			flash = { type: 'error', text: e.message };
		} finally {
			pending = null;
		}
	}

	async function saveSettings() {
		pending = 'settings';
		flash = null;
		try {
			raw = await send('/api/control', {
				action: 'settings',
				accountId: snap.id,
				settings: { ...settings }
			});
			dirty = false;
			flash = { type: 'ok', text: 'Réglages enregistrés.' };
		} catch (e) {
			flash = { type: 'error', text: e.message };
		} finally {
			pending = null;
		}
	}

	async function saveToken(event) {
		event?.preventDefault();
		if (!tokenInput.trim()) return;
		tokenBusy = true;
		flash = null;
		try {
			const next = await send('/api/token', { token: tokenInput.trim() });
			raw = next;
			if (next.selected?.id) acctId = next.selected.id;
			tokenInput = '';
			adding = false;
			dirty = false;
			flash = { type: 'ok', text: 'Clé enregistrée, le bot repart.' };
		} catch (e) {
			flash = { type: 'error', text: e.message };
		} finally {
			tokenBusy = false;
		}
	}

	async function clearToken() {
		const name = snap.pseudo ?? 'ce compte';
		if (!confirm(`Supprimer ${name} ? Sa clé sera oubliée et son bot arrêté.`)) return;
		tokenBusy = true;
		try {
			raw = await send('/api/token', { accountId: snap.id }, 'DELETE');
			acctId = raw.selected?.id ?? null;
			flash = { type: 'ok', text: 'Compte supprimé.' };
		} catch (e) {
			flash = { type: 'error', text: e.message };
		} finally {
			tokenBusy = false;
		}
	}

	function isTypeOn(id) {
		return !settings.types || settings.types.includes(id);
	}
	async function logout() {
		await fetch('/api/logout', { method: 'POST' });
		location.href = '/login';
	}

	async function loadUsers() {
		try {
			const res = await fetch('/api/users', { cache: 'no-store' });
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? 'Erreur');
			users = body.users;
			usersError = null;
		} catch (e) {
			usersError = e.message;
		}
	}

	$effect(() => {
		if (me?.role === 'admin' || authMode === 'open') loadUsers();
	});

	async function createUser(event) {
		event.preventDefault();
		usersError = null;
		try {
			const res = await fetch('/api/users', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username: newUsername, role: newRole })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? 'Erreur');
			generated = { username: body.user.username, password: body.password };
			newUsername = '';
			await loadUsers();
			if (body.loggedIn) location.reload();
		} catch (e) {
			usersError = e.message;
		}
	}

	async function resetPassword(user) {
		usersError = null;
		try {
			const res = await fetch(`/api/users/${user.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ resetPassword: true })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? 'Erreur');
			generated = { username: user.username, password: body.password };
		} catch (e) {
			usersError = e.message;
		}
	}

	async function removeUser(user) {
		if (!confirm(`Supprimer l'utilisateur ${user.username} ?`)) return;
		usersError = null;
		try {
			const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error((await res.json()).message ?? 'Erreur');
			await loadUsers();
		} catch (e) {
			usersError = e.message;
		}
	}

	function toggleType(id) {
		const all = freeTypes.map((t) => t.id);
		let list = settings.types ? [...settings.types] : [...all];
		list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
		settings.types = list.length && list.length < all.length ? list : null;
		dirty = true;
	}
</script>

<svelte:head><title>Kyara — Bot</title></svelte:head>

<div class="wrap">
	<header>
		<div class="brand">
			<span class="brand-kyara">KYARA</span>
			<span class="brand-bot">BOT</span>
			<div class="brand-sub">collecteur de boosters gratuits</div>
		</div>

		<div class="head-right">
			{#if snap.account}
				<div class="account">
					{#if snap.account.discord?.avatar}
						<img src={snap.account.discord.avatar} alt="" width="34" height="34" />
					{:else}
						<div class="avatar-fallback">{(snap.account.pseudo ?? '?')[0]}</div>
					{/if}
					<div class="account-text">
						<strong>{snap.account.pseudo}</strong>
						<span>◆ {snap.account.chakra ?? 0} chakra</span>
					</div>
				</div>
			{/if}
			<div class="status {status.tone}">
				<i></i>{status.label}
			</div>
			{#if me}
				<div class="account">
					<div class="account-text">
						<strong>{me.username}</strong>
						<span>{me.role === 'admin' ? 'administrateur' : 'membre'}</span>
					</div>
				</div>
				<button class="link" onclick={logout}>Déconnexion</button>
			{/if}
		</div>
	</header>

	{#if flash}
		<div class="flash {flash.type}">{flash.text}</div>
	{/if}

	{#if raw.accounts.length}
		<div class="accounts">
			{#each raw.accounts as a (a.id)}
				<button
					type="button"
					class="chip"
					class:active={a.id === raw.selected?.id}
					onclick={() => selectAccount(a.id)}
					title={a.pseudo ?? a.id}
				>
					{#if a.avatar}
						<img src={a.avatar} alt="" />
					{:else}
						<span class="chip-fallback">{(a.pseudo ?? '?')[0]}</span>
					{/if}
					<span class="chip-body">
						<strong>{a.pseudo ?? 'Compte'}</strong>
						<span class="chip-meta">
							{a.freePacks}/{a.freePacksMax}
							{#if a.tokenInvalid}· clé invalide{:else if !a.running}· pause{:else if a.busy}· en cours{/if}
							{#if me?.role === 'admin' && a.owner && a.owner !== me.username}· {a.owner}{/if}
						</span>
					</span>
				</button>
			{/each}

			{#if raw.accounts.length < raw.maxAccounts}
				<button type="button" class="chip add" onclick={() => (adding = !adding)}>
					+ Compte
				</button>
			{/if}
		</div>
	{/if}

	{#if adding}
		<section class="panel add-panel">
			<div class="panel-head">
				<h2>Ajouter un compte</h2>
				<button
					class="link"
					onclick={() => {
						adding = false;
						tokenInput = '';
					}}
				>
					Annuler
				</button>
			</div>
			<p class="note">
				Connecte-toi sur kyara.games avec l'autre compte Discord, puis colle sa clé :
				<code>copy(localStorage.getItem('kyara_token'))</code>
			</p>
			<form class="token-form" onsubmit={saveToken}>
				<input
					type={tokenVisible ? 'text' : 'password'}
					bind:value={tokenInput}
					placeholder="Clé du compte à ajouter"
					autocomplete="off"
					spellcheck="false"
				/>
				<button class="ghost" type="button" onclick={() => (tokenVisible = !tokenVisible)}>
					{tokenVisible ? 'Masquer' : 'Voir'}
				</button>
				<button class="primary" type="submit" disabled={tokenBusy || !tokenInput.trim()}>
					{tokenBusy ? 'Vérification…' : 'Ajouter'}
				</button>
			</form>
		</section>
	{/if}

	{#if !snap.tokenSet}
		<section class="onboard panel">
			<h2>Connecter ton compte</h2>
			<p class="lead">
				Le bot n'a pas besoin de ton mot de passe Discord : il utilise la clé de session que Kyara
				émet après ta connexion. Elle reste chiffrée sur cette machine.
			</p>
			<ol>
				<li>
					Ouvre <a href="https://kyara.games" target="_blank" rel="noreferrer">kyara.games</a> et
					connecte-toi avec Discord (comme d'habitude).
				</li>
				<li>Ouvre la console du navigateur (<kbd>F12</kbd> → onglet <em>Console</em>).</li>
				<li>Colle cette ligne, elle copie la clé dans le presse-papier :</li>
			</ol>
			<pre>copy(localStorage.getItem('kyara_token'))</pre>
			<form class="token-form" onsubmit={saveToken}>
				<input
					type={tokenVisible ? 'text' : 'password'}
					bind:value={tokenInput}
					placeholder="Colle la clé ici (64 caractères)"
					autocomplete="off"
					spellcheck="false"
				/>
				<button class="ghost" type="button" onclick={() => (tokenVisible = !tokenVisible)}>
					{tokenVisible ? 'Masquer' : 'Voir'}
				</button>
				<button class="primary" type="submit" disabled={tokenBusy || !tokenInput.trim()}>
					{tokenBusy ? 'Vérification…' : 'Connecter'}
				</button>
			</form>
		</section>
	{:else}
		<div class="grid-main">
			<section class="panel gauge-card">
				<div class="panel-head">
					<h2>Réserve</h2>
					<div class="head-actions">
						<span class="tag">gratuit</span>
						<button class="link" onclick={() => act('sync')} disabled={pending !== null}>
							{pending === 'sync' ? 'Relevé…' : 'Synchroniser'}
						</button>
					</div>
				</div>

				<div class="gauge">
					<div class="gauge-value" class:approx={estFree !== freePacks}>
						{estFree}<small>/{cap}</small>
					</div>
					<div class="bar"><div class="fill" style="width: {pctEst}%"></div></div>
					<p class="stale">
						{#if checkedAgoMs == null}
							Jamais relevé
						{:else}
							Relevé il y a {fmtDur(checkedAgoMs)}{#if estFree !== freePacks}<span class="est">
								· ≈ estimé</span
							>{/if}
						{/if}
					</p>
				</div>

				<div class="rows">
					<div class="row">
						<span>Prochain booster</span>
						<strong class:soon={nextFreeMs != null && nextFreeMs < 60_000}>
							{nextFreeMs != null ? fmtDur(nextFreeMs) : '—'}
						</strong>
					</div>
					<div class="row">
						<span>Prochain passage</span>
						<strong>{nextRunMs != null ? fmtDur(nextRunMs) : '—'}</strong>
					</div>
					<div class="row">
						<span>Dernier passage</span>
						<strong>{fmtDateTime(snap.bot.lastRunAt)}</strong>
					</div>
				</div>

				{#if snap.bot.lastError}
					<p class="err">{snap.bot.lastError}</p>
				{/if}
			</section>

			<section class="panel controls">
				<div class="panel-head">
					<h2>Contrôle</h2>
				</div>

				<div class="buttons">
					<button class="primary" onclick={() => act('run')} disabled={pending !== null}>
						{pending === 'run' ? 'Ouverture…' : 'Ouvrir maintenant'}
					</button>
					{#if snap.bot.running}
						<button class="ghost" onclick={() => act('pause')} disabled={pending !== null}>
							Pause
						</button>
					{:else}
						<button class="ghost" onclick={() => act('resume')} disabled={pending !== null}>
							Reprendre
						</button>
					{/if}
				</div>

				<p class="note">
					Cycle toutes les <strong>{snap.settings.pollMinutes} min</strong> au maximum, et plus tôt si la
					réserve approche du plafond (pour ne rien perdre).
				</p>

				<div class="mini-grid">
					<div class="mini">
						<span>Ouverts</span>
						<strong>{snap.stats.opened}</strong>
					</div>
					<div class="mini">
						<span>Cartes</span>
						<strong>{totalCards}</strong>
					</div>
					<div class="mini">
						<span>Pity</span>
						<strong>{snap.account?.pity ?? 0}</strong>
					</div>
					<div class="mini">
						<span>Golden dans</span>
						<strong>{snap.account?.goldenIn ?? '—'}</strong>
					</div>
				</div>
			</section>

			<section class="panel rarities">
				<div class="panel-head">
					<h2>Raretés obtenues</h2>
				</div>
				<div class="rarity-grid">
					{#each ORDER as r (r)}
						{@const info = RARITY[r]}
						{@const n = snap.stats.byRarity?.[r] ?? 0}
						<div class="rarity" style="--c: {info.color}">
							<div class="rarity-letter">{r}</div>
							<div class="rarity-name">{info.label}</div>
							<div class="rarity-count">{n}</div>
							<div class="rarity-bar">
								<div style="width: {totalCards ? (n / totalCards) * 100 : 0}%"></div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		</div>

		<div class="grid-lower">
			<section class="panel history">
				<div class="panel-head">
					<h2>Derniers boosters</h2>
					<span class="tag">{snap.opens.length}</span>
				</div>

				{#if snap.opens.length === 0}
					<p class="empty">Rien encore. Lance un passage manuel pour tester.</p>
				{:else}
					<ul>
						{#each snap.opens as entry, idx (entry.at + entry.packId + idx)}
							{@const best = entry.best ? RARITY[entry.best] : null}
							<li style="--c: {best?.color ?? '#3a3448'}">
								<div class="open-top">
									<span class="pack">{entry.packName}</span>
									<span class="time">{fmtTime(entry.at)}</span>
								</div>
								<div class="cards">
									{#each entry.cards as card, i (i)}
										<span
											class="card-chip"
											style="--c: {RARITY[card.rarity]?.color ?? '#8b849c'}"
											title={RARITY[card.rarity]?.label ?? ''}
										>
											{card.name}
										</span>
									{:else}
										<span class="empty">aucune carte</span>
									{/each}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="panel logs">
				<div class="panel-head">
					<h2>Journal</h2>
					<button class="link" onclick={() => act('clear-logs')} disabled={pending !== null}>
						Vider
					</button>
				</div>
				<ul>
					{#each snap.logs as line, i (line.at + i)}
						<li class={line.level}>
							<span class="t">{fmtTime(line.at)}</span>
							<span class="m">{line.message}</span>
						</li>
					{:else}
						<li class="empty">Aucun événement.</li>
					{/each}
				</ul>
			</section>
		</div>

		<div class="grid-settings">
			<section class="panel">
				<div class="panel-head">
					<h2>Réglages</h2>
					{#if dirty}<span class="tag warn">non enregistré</span>{/if}
				</div>

				<div class="fields">
					<label>
						<span>Intervalle max (minutes)</span>
						<input
							type="number"
							min="5"
							max="1440"
							bind:value={settings.pollMinutes}
							oninput={() => (dirty = true)}
						/>
					</label>
					<label>
						<span>Boosters max par passage</span>
						<input
							type="number"
							min="1"
							max="10"
							bind:value={settings.maxPerRun}
							oninput={() => (dirty = true)}
						/>
					</label>
				</div>

				<div class="switches">
					<label class="switch">
						<input
							type="checkbox"
							bind:checked={settings.dailyPack}
							onchange={() => (dirty = true)}
						/>
						<span>Ouvrir aussi le pack du jour</span>
					</label>
					<label class="switch">
						<input type="checkbox" bind:checked={settings.smart} onchange={() => (dirty = true)} />
						<span>Réveil anticipé près du plafond</span>
					</label>
					<label class="switch">
						<input
							type="checkbox"
							bind:checked={settings.humanDelay}
							onchange={() => (dirty = true)}
						/>
						<span>Délai humain entre deux ouvertures</span>
					</label>
				</div>

				<h3>Types de boosters</h3>
				<div class="types">
					{#each freeTypes as type (type.id)}
						<label class="type" class:on={isTypeOn(type.id)}>
							<input type="checkbox" checked={isTypeOn(type.id)} onchange={() => toggleType(type.id)} />
							<span class="kanji">{type.kanji ?? '·'}</span>
							<span>{type.name}</span>
						</label>
					{:else}
						<p class="empty">Liste des boosters pas encore chargée.</p>
					{/each}
				</div>

				<button class="primary" onclick={saveSettings} disabled={pending !== null}>
					{pending === 'settings' ? 'Enregistrement…' : 'Enregistrer'}
				</button>
			</section>

			<section class="panel">
				<div class="panel-head">
					<h2>Clé Kyara</h2>
					{#if snap.tokenSet}<span class="tag ok">enregistrée</span>{/if}
				</div>

				<p class="note">
					{snap.tokenSet
						? `Clé chiffrée localement, ajoutée le ${fmtDateTime(snap.tokenSetAt)}.`
						: 'Aucune clé enregistrée.'}
					{#if snap.tokenInvalid}<strong class="danger">
							Elle est refusée par Kyara : recolle-en une.</strong
						>{/if}
				</p>

				<form class="token-form" onsubmit={saveToken}>
					<input
						type={tokenVisible ? 'text' : 'password'}
						bind:value={tokenInput}
						placeholder="Nouvelle clé (localStorage.kyara_token)"
						autocomplete="off"
						spellcheck="false"
					/>
					<button class="ghost" type="button" onclick={() => (tokenVisible = !tokenVisible)}>
						{tokenVisible ? 'Masquer' : 'Voir'}
					</button>
					<button class="primary" type="submit" disabled={tokenBusy || !tokenInput.trim()}>
						{tokenBusy ? '…' : 'Remplacer'}
					</button>
				</form>

				{#if snap.tokenSet}
					<button class="link danger" onclick={clearToken} disabled={tokenBusy}>
						Supprimer ce compte
					</button>
				{/if}

				<p class="note small">
					La clé se récupère sur kyara.games, connecté :
					<code>copy(localStorage.getItem('kyara_token'))</code>
				</p>
			</section>
		</div>
	{/if}

	{#if me?.role === 'admin' || authMode === 'open'}
		<section class="panel users-panel">
			<div class="panel-head">
				<h2>Utilisateurs</h2>
				<span class="tag">{users.length}</span>
			</div>

			<p class="note">
				Chaque personne gère <strong>ses propres comptes Kyara</strong> : elle ne voit ni les tiens
				ni tes clés, et ses actions ne touchent que ses comptes. Le bot tourne pour tout le monde.
			</p>

			{#if generated}
				<div class="flash ok">
					Mot de passe pour <strong>{generated.username}</strong> :
					<code>{generated.password}</code> — affiché une seule fois.
				</div>
			{/if}
			{#if usersError}<p class="err">{usersError}</p>{/if}

			<div class="users-list">
				{#each users as u (u.id)}
					<div class="user-row">
						<div>
							<strong>{u.username}</strong>
							<span class="tag {u.role === 'admin' ? 'ok' : ''}">
								{u.role === 'admin' ? 'administrateur' : 'membre'}
							</span>
							<span class="user-meta">{u.accounts} compte(s) Kyara</span>
						</div>
						<div class="user-actions">
							<button class="link" onclick={() => resetPassword(u)}>Réinitialiser</button>
							{#if u.id !== me?.id}
								<button class="link danger" onclick={() => removeUser(u)}>Supprimer</button>
							{/if}
						</div>
					</div>
				{:else}
					<p class="empty">
						Aucun utilisateur : le tableau de bord est en accès libre. Crée le premier compte
						pour activer la connexion.
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
				<select bind:value={newRole}>
					<option value="member">membre</option>
					<option value="admin">administrateur</option>
				</select>
				<button class="primary" type="submit" disabled={newUsername.trim().length < 3}>
					Créer
				</button>
			</form>
			<p class="note small">Le mot de passe est généré côté serveur et n'est affiché qu'une fois.</p>
		</section>
	{/if}

	<footer>
		<span>Kyara Bot · non-officiel</span>
		<span>Les actions passent par l'API du site avec ta propre session.</span>
	</footer>
</div>

<style>
	.wrap {
		max-width: 1180px;
		margin: 0 auto;
		padding: 26px 20px 60px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		flex-wrap: wrap;
		margin-bottom: 22px;
	}

	.brand-kyara {
		font-size: 26px;
		font-weight: 900;
		letter-spacing: 0.16em;
		color: var(--gold);
	}
	.brand-bot {
		font-size: 26px;
		font-weight: 300;
		letter-spacing: 0.24em;
		margin-left: 8px;
	}
	.brand-sub {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		color: var(--muted);
		margin-top: 2px;
	}

	.head-right {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.account {
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 5px 14px 5px 5px;
	}
	.account img,
	.avatar-fallback {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		object-fit: cover;
		background: #2a2436;
		display: grid;
		place-items: center;
		font-weight: 700;
	}
	.account-text {
		display: grid;
		line-height: 1.15;
	}
	.account-text strong {
		font-size: 13px;
	}
	.account-text span {
		font-size: 11px;
		color: var(--muted);
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		font-weight: 600;
		padding: 7px 13px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--panel);
	}
	.status i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}
	.status.ok {
		color: var(--green);
	}
	.status.warn {
		color: var(--amber);
	}
	.status.danger {
		color: var(--red);
	}
	.status.busy {
		color: var(--blue);
	}
	.status.muted {
		color: var(--muted);
	}

	.flash {
		border-radius: 12px;
		padding: 10px 14px;
		font-size: 13px;
		margin-bottom: 16px;
		border: 1px solid var(--line);
	}
	.flash.ok {
		background: rgba(52, 211, 153, 0.08);
		border-color: rgba(52, 211, 153, 0.35);
		color: #86efac;
	}
	.flash.error {
		background: rgba(248, 113, 113, 0.08);
		border-color: rgba(248, 113, 113, 0.35);
		color: #fca5a5;
	}

	.panel {
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.018), transparent), var(--panel);
		border: 1px solid var(--line);
		border-radius: 18px;
		padding: 18px 20px;
		min-width: 0;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 14px;
	}
	h2 {
		margin: 0;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--muted);
		font-weight: 700;
	}
	h3 {
		margin: 18px 0 10px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--muted);
	}
	.tag {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--muted);
	}
	.tag.ok {
		color: var(--green);
		border-color: rgba(52, 211, 153, 0.4);
	}
	.tag.warn {
		color: var(--amber);
		border-color: rgba(251, 191, 36, 0.4);
	}

	.grid-main {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.rarities {
		grid-column: 1 / -1;
	}

	.gauge-value {
		font-family: var(--mono);
		font-size: 54px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.02em;
	}
	.gauge-value small {
		font-size: 20px;
		color: var(--muted);
		font-weight: 500;
	}
	.gauge-value.approx {
		color: #f0d67a;
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.stale {
		margin: 0 0 16px;
		font-size: 11.5px;
		color: var(--muted);
	}
	.est {
		color: #f0d67a;
	}
	.bar {
		margin: 14px 0 18px;
		height: 9px;
		border-radius: 999px;
		background: #1d1929;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: linear-gradient(90deg, #b08d0c, var(--gold));
		transition: width 0.5s ease;
	}

	.rows {
		display: grid;
		gap: 8px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		padding: 7px 0;
		border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
	}
	.row span {
		color: var(--muted);
	}
	.row strong {
		font-family: var(--mono);
		font-weight: 500;
	}
	.row strong.soon {
		color: var(--gold);
	}

	.err {
		margin: 14px 0 0;
		font-size: 12px;
		color: #fca5a5;
		background: rgba(248, 113, 113, 0.07);
		border: 1px solid rgba(248, 113, 113, 0.25);
		border-radius: 10px;
		padding: 8px 10px;
	}

	.buttons {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	button.primary,
	button.ghost {
		border-radius: 11px;
		padding: 10px 16px;
		font-weight: 700;
		font-size: 13px;
		border: 1px solid transparent;
		transition:
			transform 0.08s ease,
			opacity 0.2s;
	}
	button.primary {
		background: var(--gold);
		color: #191307;
	}
	button.ghost {
		background: transparent;
		border-color: var(--line);
		color: var(--text);
	}
	button.primary:hover:not(:disabled),
	button.ghost:hover:not(:disabled) {
		transform: translateY(-1px);
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--muted);
		font-size: 12px;
		text-decoration: underline;
	}
	button.link.danger {
		color: var(--red);
		margin-top: 12px;
	}
	.danger {
		color: var(--red);
	}

	.note {
		color: var(--muted);
		font-size: 12.5px;
		line-height: 1.55;
		margin: 14px 0 0;
	}
	.note.small {
		font-size: 11.5px;
	}
	code,
	pre {
		font-family: var(--mono);
		font-size: 12px;
	}
	code {
		background: #0c0a12;
		padding: 2px 6px;
		border-radius: 6px;
		border: 1px solid var(--line);
	}
	pre {
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 12px;
		overflow-x: auto;
	}

	.mini-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
		margin-top: 18px;
	}
	.mini {
		background: #0e0c15;
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 10px;
		display: grid;
		gap: 3px;
	}
	.mini span {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	.mini strong {
		font-family: var(--mono);
		font-size: 17px;
	}

	.rarity-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
	}
	.rarity {
		background: #0e0c15;
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 12px;
		position: relative;
		overflow: hidden;
	}
	.rarity::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 3px;
		background: var(--c);
	}
	.rarity-letter {
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 700;
		color: var(--c);
	}
	.rarity-name {
		font-size: 11px;
		color: var(--muted);
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rarity-count {
		font-family: var(--mono);
		font-size: 22px;
		font-weight: 700;
		margin-top: 6px;
	}
	.rarity-bar {
		height: 4px;
		background: #1d1929;
		border-radius: 999px;
		overflow: hidden;
		margin-top: 8px;
	}
	.rarity-bar div {
		height: 100%;
		background: var(--c);
	}

	.grid-lower {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 16px;
		margin-top: 16px;
	}

	.history ul,
	.logs ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
		max-height: 420px;
		overflow-y: auto;
	}
	.history li {
		background: #0e0c15;
		border: 1px solid var(--line);
		border-left: 3px solid var(--c);
		border-radius: 12px;
		padding: 10px 12px;
	}
	.open-top {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		margin-bottom: 7px;
	}
	.pack {
		font-weight: 700;
	}
	.time {
		color: var(--muted);
		font-family: var(--mono);
	}
	.cards {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.card-chip {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
		color: var(--c);
		background: color-mix(in srgb, var(--c) 10%, transparent);
	}

	.logs li {
		display: flex;
		gap: 9px;
		font-size: 12px;
		line-height: 1.45;
		padding: 6px 0;
		border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
	}
	.logs .t {
		color: var(--muted);
		font-family: var(--mono);
		flex: 0 0 auto;
	}
	.logs .m {
		min-width: 0;
		word-break: break-word;
	}
	.logs li.error .m {
		color: #fca5a5;
	}
	.logs li.warn .m {
		color: #fcd34d;
	}
	.logs li.success .m {
		color: #86efac;
		font-weight: 600;
	}

	.grid-settings {
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: 16px;
		margin-top: 16px;
	}

	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.fields label {
		display: grid;
		gap: 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	.fields input {
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 9px 11px;
		color: var(--text);
		font-family: var(--mono);
	}

	.switches {
		display: grid;
		gap: 8px;
		margin-top: 16px;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 13px;
	}
	.switch input,
	.type input {
		accent-color: var(--gold);
	}

	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}
	.type {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		padding: 6px 11px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--muted);
		cursor: pointer;
		user-select: none;
	}
	.type.on {
		color: var(--text);
		border-color: rgba(245, 197, 24, 0.4);
		background: rgba(245, 197, 24, 0.07);
	}
	.type input {
		display: none;
	}
	.kanji {
		font-size: 13px;
		opacity: 0.85;
	}

	.token-form {
		display: flex;
		gap: 8px;
		margin-top: 16px;
		flex-wrap: wrap;
	}
	.token-form input {
		flex: 1 1 220px;
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
		color: var(--text);
		font-family: var(--mono);
		font-size: 12px;
	}

	.onboard {
		max-width: 680px;
		margin: 0 auto;
	}
	.onboard h2 {
		font-size: 20px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text);
		margin-bottom: 10px;
	}
	.lead {
		color: var(--muted);
		font-size: 13.5px;
		line-height: 1.6;
	}
	.onboard ol {
		color: var(--muted);
		font-size: 13px;
		line-height: 1.8;
		padding-left: 18px;
	}
	kbd {
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 1px 5px;
		font-family: var(--mono);
		font-size: 11px;
	}

	.empty {
		color: var(--muted);
		font-size: 12.5px;
		margin: 0;
	}

	footer {
		margin-top: 28px;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		font-size: 11.5px;
		color: #5f5872;
	}

	.accounts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		padding: 6px 14px 6px 6px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--text);
		text-align: left;
	}
	.chip img,
	.chip-fallback {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		object-fit: cover;
		background: #2a2436;
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 13px;
	}
	.chip-body {
		display: grid;
		line-height: 1.15;
	}
	.chip-body strong {
		font-size: 12.5px;
	}
	.chip-meta {
		font-size: 11px;
		color: var(--muted);
	}
	.chip.active {
		border-color: rgba(245, 197, 24, 0.55);
		background: rgba(245, 197, 24, 0.08);
	}
	.chip.add {
		padding: 9px 14px;
		color: var(--muted);
		font-size: 12.5px;
		font-weight: 600;
		border-style: dashed;
	}
	.chip.add:hover {
		color: var(--gold);
		border-color: rgba(245, 197, 24, 0.45);
	}

	.add-panel {
		margin-bottom: 16px;
		border-color: rgba(245, 197, 24, 0.25);
	}

	.users-panel {
		margin-top: 16px;
	}
	.users-list {
		display: grid;
		gap: 6px;
		margin: 14px 0;
	}
	.user-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 9px 12px;
		background: #0e0c15;
		border: 1px solid var(--line);
		border-radius: 10px;
		font-size: 13px;
	}
	.user-row strong {
		margin-right: 8px;
	}
	.user-meta {
		font-size: 11.5px;
		color: var(--muted);
		margin-left: 8px;
	}
	.user-actions {
		display: flex;
		gap: 12px;
	}
	.token-form select {
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
		color: var(--text);
		font-size: 12.5px;
	}

	@media (max-width: 900px) {
		.grid-main,
		.grid-lower,
		.grid-settings {
			grid-template-columns: 1fr;
		}
		.rarities {
			grid-column: auto;
		}
		.rarity-grid {
			grid-template-columns: repeat(3, 1fr);
		}
		.mini-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
