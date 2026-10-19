# The editor of the translations

A table of the keys of the locale files, for a translator and a reviewer
(DB-213). It reads and writes through the routes `/i18n/*` of the API, and
holds no data of its own.

## Run it

```sh
VITE_API=http://localhost:8001 pnpm -F @i18n-editor/web dev
```

`VITE_API` is the address of the API. The page is a single-page application:
the session cookie belongs to the origin of the API, so a server here could
not read it.

The local API refuses the page until its `KNOWN_HOSTS` names the origin that
Vite prints, for example `http://localhost:5173`. Add it to `packages/api/.env`.

## What the API must hold

- **The origin of this application in `KNOWN_HOSTS`.** The API answers CORS
  with credentials for the origins of that list, and better-auth trusts the
  same list. Without it, the browser refuses every call and the page stays on
  the sign-in.
- **A repository**, added with `POST /i18n/repositories` (DB-210). With none,
  the API answers 503 and the page says that the tool is not set up.
- **A grant.** A sign-in gives no language (DB-218). An account opens the
  table if it administers, or if a row of `i18n_translators` names it. An
  admin with no row reads every language and writes none.

## What it is built with

React Router in framework mode, as a single-page application (`ssr: false`):
nginx serves it as static files. Tailwind v4, and the components of **HeroUI v3**
for every control — buttons, tabs, selects, fields, boxes, alerts.

`app/app.css` names the parts of `@heroui/styles` in use one by one, as the admin
of the game does, and maps the tokens of HeroUI on the colours of the editor. So
a primary button is ink, a field has an edge that holds 3:1 on white, and the
ring of the keyboard is the blue. To use one more component, add its stylesheet
to that list: without it the component renders with no style, and nothing warns.

HeroUI names `accent`, `danger`, `surface`, `muted`, `field` and `success`
itself. The editor names its own colours `signal`, `alarm`, `panel` and `edge`.

## Who may create a key

An account adds a key to the source language with « Nouvelle clé » if its row of
`i18n_translators` says `writes_source`. It is a right of its own: a reviewer of
every language does not hold it, and neither does an admin. No route writes this
row, so somebody with access to the database grants it:

```sql
insert into i18n_translators (user_id, writes_source)
values ('<the id of the account>', true)
on conflict (user_id) do update set writes_source = true;
```

The key is written on the base branch at once, with no proposal. It adds and
never changes: a key that the file holds is refused. The account then reads every
language of the repository, to see where the key is missing.

## What it shows

One row per key of the source, the missing keys first, then the proposed, then
the published. « Proposed » comes from `GET /i18n/proposals/keys`: a key that
the base branch already says is published, whatever its batch says.

A file that the manifest disables for the language has no row, and the page
says that it has no version (DB-225). [`docs/repositories.md`](../../docs/repositories.md)
gives the format of the manifest.

## Deploy it

The image is static: `packages/web/Dockerfile` builds the page, and nginx serves
it on port 80. Build it from the root of the repository.

```sh
docker build -f packages/web/Dockerfile \
  --build-arg VITE_API=https://i18n-api.example.com -t i18n-editor-web .
```

`VITE_API` is a build argument. Vite writes the address into the JavaScript,
so a change of the variable on a container that runs changes nothing.

## Tests

`pnpm -F @i18n-editor/web test` runs the rules of the table (`app/editor/rows.ts`). No test
renders a component.
