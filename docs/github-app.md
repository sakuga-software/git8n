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
| Email addresses (account) | read   | Read the addresses of a person at the sign-in, with their `verified` flag. `ADMIN_EMAILS` needs it. |

The App asks for nothing more. It opens no pull request: a proposal is a commit
on the branch `i18n/<language>`, and a publication is a commit on the base
branch of the repository.

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
   `/api/auth/callback/github`. Change `redirect_url` to a page that you
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

## Connect a repository

1. Install the App on the repository, from `https://github.com/apps/<slug>`.
2. `GET /i18n/installations` gives the installation and the repositories it
   reaches.
3. `POST /i18n/repositories` adds the repository. `docs/repositories.md` gives
   the fields.

**A protected branch refuses the publications.** If the base branch requires a
pull request or a review, add the App to the list of actors that can bypass
the rule. Otherwise each publication fails, and the proposals stay on their
branch.
