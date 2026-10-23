# Kyara Bot

Bot personnel pour [kyara.games](https://kyara.games) : il ouvre les boosters gratuits
avant que la réserve (10 max, +1 toutes les ~10 min) ne soit pleine, en alternant les
types de boosters. Un tableau de bord SvelteKit (Svelte 5) affiche l'état en direct.

## Comment l'authentification fonctionne

La connexion Discord ne sert qu'**une fois** : après le OAuth, Kyara émet un token
opaque stocké dans `localStorage.kyara_token`. Ensuite, toutes les requêtes authentifiées
sont de simples `Authorization: Bearer <token>` — aucun cookie, aucune session Discord.

Conséquence : le bot n'a pas besoin de Discord, d'un navigateur ni d'un OAuth.
Il a juste besoin de cette clé, récupérable depuis la console du navigateur :

```js
copy(localStorage.getItem('kyara_token'))
```

Pourquoi pas un « Se connecter avec Discord » dans l'interface du bot ? Parce que le
token Kyara est émis par **le serveur de Kyara** avec **son propre client OAuth**. Un
OAuth Discord lancé par le bot renverrait un code pour un autre client : Kyara refuserait
l'échange. Il faudrait automatiser un vrai login Discord (2FA, captcha) — fragile et
contraire aux CGU de Discord. La clé collée une fois est donc la bonne approche.

Sécurité : la clé est chiffrée au repos (`AES-256-GCM`, clé locale dans `.data/key.bin`),
n'est jamais renvoyée au navigateur, et `.data/` est ignoré par git.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
```

Production :

```bash
npm run build
npm start          # adapter-node, port 3000 par défaut
```

Optionnel, dans `.env` (voir `.env.example`) :

```env
DASHBOARD_PASSWORD=un-mot-de-passe   # protège l'accès au tableau de bord
KYARA_DATA_DIR=C:\chemin\data        # dossier des données
```

## Docker

```bash
docker compose up -d --build
```

Dashboard : http://localhost:3000. Changer le port exposé avec `BOT_PORT` (ex. `BOT_PORT=8080`).

- Mot de passe : mets `DASHBOARD_PASSWORD=...` dans le `.env` à la racine du projet (Compose le lit
  automatiquement) ou lance `DASHBOARD_PASSWORD=... docker compose up -d`.
- Données : volume nommé `kyara-data` monté sur `/data` (clé chiffrée, `key.bin`, état, journal).
  Supprimer le volume = il faudra recoller la clé.
- Logs : `docker compose logs -f`. Après une modification du code : `docker compose up -d --build`.
- Le conteneur tourne en utilisateur `node` (uid 1000) ; le healthcheck interroge `/`.
  Derrière un reverse proxy, renseigne `ORIGIN` (décommenté dans le compose).

### Image publiée (serveur, sans build)

```bash
docker compose -f docker/docker-compose.yml up -d
```

Aucun build : l'image vient de GitHub Container Registry
(`ghcr.io/remi-petit/kyaragames-bot`), publiée à chaque release par le workflow.
Pour des redéploiements prévisibles, épingle une version (`:0.2.1`) plutôt que `:latest`.
Le package est **privé par défaut** : passe-le en public dans les réglages du package, ou
fais un `docker login ghcr.io` avec un PAT `read:packages` sur la machine cible.

## Plusieurs comptes

Chaque compte a sa propre clé, ses propres réglages, ses stats, son journal et son
planificateur (un *runner* indépendant). Dans l'interface : **+ Compte**, puis colle la clé
du second compte — l'identifiant utilisé est `me.id` (UUID Kyara), donc recoller la clé
d'un compte existant met à jour ce compte au lieu d'en créer un doublon.

- Maximum 10 comptes (`MAX_ACCOUNTS` dans `src/lib/server/state.js`).
- Un seul `state.json` : les comptes sont dans `accounts[]`. Un ancien état mono-compte
  est migré automatiquement au chargement.
- Le catalogue des boosters et la cadence de régénération sont publics : ils sont
  récupérés **une fois** pour tous les comptes.
- Le laissez-passer `x-pass` est mis en cache **par token**, pas global.
- En Docker, il faut reconstruire l'image pour bénéficier du multi-comptes :
  `docker compose up -d --build` (le volume `/data` est conservé).

## Utilisateurs

Le tableau de bord s'organise en deux pages, reliées par la barre de navigation :

- **Dashboard** (`/`) — la réserve, le compte sélectionné, le pilotage du bot, l'historique.
- **Administration** (`/admin`) — deux onglets : **Utilisateurs** (créer, changer le rôle,
  réinitialiser un mot de passe, supprimer, vue d'ensemble des comptes Kyara) et
  **Notifications** (ntfy). Page réservée aux administrateurs (403 pour un membre) ; le lien
  n'apparaît dans la navigation que pour eux.

Le tableau de bord gère plusieurs utilisateurs, chacun avec **ses propres comptes Kyara** :

- **Premier lancement** : accès libre (aucun utilisateur). La page **Administration** crée le
  premier compte, qui devient administrateur et **récupère les comptes Kyara existants**.
- **Variante** : définir `DASHBOARD_PASSWORD` dans `.env` ; la première connexion (n'importe quel
  nom d'utilisateur) crée l'administrateur avec ce mot de passe et réclame les comptes existants.
- Ensuite, chaque personne a son identifiant et ne voit que ses comptes. Rôles :
  `administrateur` (tout + gestion des utilisateurs) / `membre` (ses comptes uniquement).
- Mots de passe hachés avec scrypt (sel par utilisateur). Sessions = cookie signé HMAC portant un
  compteur de version : changer un mot de passe invalide les sessions ouvertes de cet utilisateur.
- Le bot continue de tourner pour **tous** les comptes ; c'est l'accès (interface + API) qui est
  cloisonné, pas le moteur.

## Notifications ntfy

Onglet **Notifications** de `/admin`. Chaque utilisateur a **sa propre** configuration (l'admin
peut éditer celle de chacun) :

| Champ | Rôle |
|---|---|
| Serveur | `https://ntfy.sh` par défaut, ou une instance auto-hébergée |
| Topic | celui auquel tu t'abonnes dans l'appli ntfy |
| Jeton | facultatif (`Authorization: Bearer`), chiffré au repos comme les clés Kyara |
| Cases | *Légendaire ou mythique*, *Erreurs (clé refusée, réseau)* |

Envoi : `POST <serveur>/<topic>`, corps texte UTF-8, en-têtes `Title` (ramené en ASCII : les
en-têtes HTTP n'acceptent pas les accents), `Priority` (5 pour un mythique, 4 pour une erreur),
`Tags`. Un `POST /api/users/<id>` envoie un message de test avec la config **enregistrée**.

Les erreurs sont tempérées : au plus une notification par demi-heure et par compte, pour ne pas
inonder quand le site est en panne. Un envoi qui échoue n'interrompt jamais le bot.

## Temps réel

L'interface ne sonde plus le serveur toutes les 2 s : elle s'abonne à `GET /api/stream`
en **Server-Sent Events**. Le serveur pousse l'état complet du compte visible dès qu'il
change (ouverture, réglage, pause, journal), avec un lissage de 250 ms pour absorber les
rafales. Un `GET /api/state` toutes les 20 s sert de filet de sécurité, et `EventSource`
se reconnecte seul.

Pourquoi SSE plutôt qu'un WebSocket : le flux est unidirectionnel (serveur → navigateur),
les actions restent en `POST` JSON, et adapter-node sert le flux sur le même port — pas de
serveur custom ni de dépendance supplémentaire.

## Comportement

- À chaque passage : `GET /api/me`, puis ouverture de **tous** les boosters disponibles
  (max 10), un par type, en round-robin sur les types activés.
- Le prochain passage est planifié à `min(intervalle max, instant où la réserve
  atteindrait 10)`. C'est ce qui garantit qu'aucun booster n'est perdu, tout en restant
  à ~1 h 30 entre deux passages quand la réserve est basse.
- Un `x-pass` (laissez-passer anti-bot, valable 30 min) est demandé automatiquement
  quand l'API répond `pass_required`, et renouvelé au besoin.
- Sur `401` : le bot se met en pause et le tableau de bord demande une nouvelle clé
  (il ne bascule **pas** en compte invité comme le fait le site).
- `crypto.randomUUID()` est envoyé en `x-request-id` à chaque ouverture (idempotence
  côté serveur).

## Releases

Une release est publiée automatiquement à partir d'un tag de version :

```bash
npm version 0.1.0        # bump package.json + commit + tag v0.1.0
git push --follow-tags   # déclenche .github/workflows/release.yml
```

Deux workflows complètent le tableau :

| Workflow | Déclencheur | Rôle |
|---|---|---|
| `ci.yml` | chaque poussée sur `master`, chaque PR | `npm ci` → `npm test` → `npm run build` |
| `release.yml` | tag `v*` | vérifie que le tag correspond à `package.json`, rejoue les tests, publie la release puis l'image GHCR |

Le workflow vérifie que la version de `package.json` correspond au tag, compile le
projet, puis crée une release **publiée** (jamais draft, jamais prerelease) avec les
notes générées par GitHub. Le tag doit toujours passer par ce canal : pas de release
manuelle dans l'interface.

## Avertissement

Projet non officiel. Les actions passent par l'API du site avec ta propre session :
automatiser un jeu peut contrevenir à ses règles et exposer le compte à des sanctions.
À utiliser sur ton compte, à rythme humain.


## Adding features

Add features to your project with `sv add`:

```sh
npx sv add
```

For example, to add Tailwind CSS:

```sh
npx sv add tailwindcss
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
