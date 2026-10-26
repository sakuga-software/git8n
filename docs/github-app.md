# The GitHub App

The editor uses one GitHub App for two things:

- **The sign-in.** A person signs in with the OAuth flow of the App, by its
  client ID and client secret.
- **The repositories.** The API reads and writes a repository through an
  installation of the App, by its ID and its private key.

One App serves every repository: install it on a repository, then add that
repository to the editor. A deployment of the editor needs its own App, because
the App holds the private key that the API signs with, and its callback URL
names the address of that deployment.

## What it may do

| Permission                | Access | Why                                                                                                 |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| Contents                  | write  | Read the locale files and the manifest. Write the branches of proposals and publish.                |
| Metadata                  | read   | List the repositories that an installation reaches. GitHub always grants it.                        |
| Pull requests             | write  | Open and update the pull request of the publications, for a repository in the mode `pull_request`.  |
| Email addresses (account) | read   | Read the addresses of a person at the sign-in, with their `verified` flag. `ADMIN_EMAILS` needs it. |

The App asks for nothing more. A proposal is a commit on the branch
`i18n/<language>`. A publication is a commit on the base branch, or, for a
repository in the mode `pull_request`, a commit on `i18n/publish` and one pull
request to the base branch. [repositories.md](repositories.md) tells the two
modes apart.

A token asks for `pull_requests: write` only for a repository in the mode
`pull_request`. A repository that publishes by commit keeps working on an
installation that never accepted it.

It has **no webhook**. The editor reads GitHub when a person opens a page, and
it never waits for an event. The manifest switches the webhook off.

## Create it

[`github-app.json`](github-app.json) is a manifest for the
[manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
of GitHub. The flow creates the App with the repository permissions and the
callback URL of the sign-in, and gives back its ID, its private key, its client
ID and its client secret in one step.

**The manifest cannot ask for the email addresses.** GitHub refuses an account
permission in `default_permissions` (« Default permission records resource is
not included in the list »). Add it by hand after the creation, at step 5.

1. Change `name` if the name is taken: the name of an App is unique on GitHub.
   Change `callback_urls` to the address of your deployment, followed by
   `/api/auth/callback/github`, and `setup_url` to the same address followed
   by `/setup`. Change `redirect_url` to a page that you
   control. GitHub sends the browser there with a `code` after the creation.
2. Send the manifest to GitHub from a browser. GitHub accepts it only as a form
   field, so save this page as `create-app.html` and open it:

   ```html
   <form action="https://github.com/organizations/<owner>/settings/apps/new" method="post">
     <input type="hidden" name="manifest" id="manifest" />
     <button>Create the App</button>
   </form>
   <script>
     fetch('github-app.json')
       .then((answer) => answer.text())
       .then((text) => (document.getElementById('manifest').value = text));
   </script>
   ```

   For an App that belongs to a personal account, use
   `https://github.com/settings/apps/new`.

3. GitHub sends the browser to `redirect_url?code=<code>`. Exchange the code
   within one hour:

   ```sh
   curl -s -X POST https://api.github.com/app-manifests/<code>/conversions \
     | jq '{id, slug, client_id, client_secret, pem}'
   ```

4. Give the four values to the API. [`deploy.md`](deploy.md) lists every
   variable of a deployment.

   | Variable                  | Value                         |
   | ------------------------- | ----------------------------- |
   | `I18N_GITHUB_APP_ID`      | `id` of the answer            |
   | `I18N_GITHUB_PRIVATE_KEY` | `pem` of the answer           |
   | `GITHUB_CLIENT_ID`        | `client_id` of the answer     |
   | `GITHUB_CLIENT_SECRET`    | `client_secret` of the answer |

   The answer also holds a webhook secret. The editor does not use it. Keep
   the private key and the client secret out of the repository.

5. In the settings of the App on GitHub, open **Permissions & events**, then
   **Account permissions**, and set **Email addresses** to **Read-only**. Save.

   **Without it, the API cannot read `/user/emails`.** Then:
   - a person whose profile shows no public address cannot sign in, because
     the account gets no address;
   - nobody is an admin, because no address is verified for `ADMIN_EMAILS`.

6. If the App was created before its manifest held `setup_url`, open
   **General** in its settings. Under **Post installation**, set **Setup URL**
   to `https://<host>/setup` and tick **Redirect on update**. Save.

   **Without it, GitHub does not come back to the editor** after an
   installation. The admin then opens the editor again and clicks « Ajouter un
   dépôt ».

## Connect a repository

An admin does it from the page:

1. « Brancher un dépôt » (or « Ajouter un dépôt », the last entry of the
   select of the repositories) opens
   `https://github.com/apps/<slug>/installations/new` in the same tab.
   `GITHUB_APP_SLUG` gives the slug.
2. After the installation, GitHub sends the browser to the Setup URL,
   `/setup?installation_id=…&setup_action=install`. The page lists the
   repositories that the installations reach.
3. The admin picks one. `GET /i18n/detection` reads its default branch, the
   folders that hold one folder per language, and the manifest beside them.
   The form starts from that answer, and every field stays editable.
4. « Brancher ce dépôt » sends `POST /i18n/repositories`, then the table of the
   repository opens. `docs/repositories.md` gives the fields.

The routes stay open to a script: `GET /i18n/installations`, then
`POST /i18n/repositories`. Sent twice, the POST answers the row that is there
with `created: false`, and writes nothing.

**A protected branch refuses a commit.** If the base branch requires a pull
request, connect the repository in the mode `pull_request`: the form proposes
it when a ruleset of the branch requires one. Do not add the App to the actors
that bypass the rule: a publication would then reach the branch with no check.

## Add the permission « Pull requests » to an App that exists

An App created before the mode `pull_request` has no permission on pull
requests. GitHub refuses the token, and the editor answers 503 with the name of
the missing permission.

1. In the settings of the App, open **Permissions & events**. Under
   **Repository permissions**, set **Pull requests** to **Read and write**.
   Save. GitHub asks for a note to the installations; it can stay empty.
2. **Each installation must accept it.** GitHub keeps the old permissions of an
   installation until an owner of the account accepts the new ones. An owner
   of the organisation opens **Settings → GitHub Apps → i18n-editor →
   Configure**, and clicks **Review request**, then **Accept new permissions**.
   GitHub also sends this request by e-mail to the owners.

Until step 2, a repository of that installation that publishes through a pull
request fails, and its header says « Permission « Pull requests » manquante ».
A repository that publishes by commit is not touched.
