# The GitHub App

The editor reads and writes a repository through a GitHub App. One App serves
every repository: install it on a repository, then add that repository to the
editor. A deployment of the editor needs its own App, because the App holds the
private key that the API signs with.

## What it may do

| Permission | Access | Why                                                                                  |
| ---------- | ------ | ------------------------------------------------------------------------------------ |
| Contents   | write  | Read the locale files and the manifest. Write the branches of proposals and publish. |
| Metadata   | read   | List the repositories that an installation reaches. GitHub always grants it.         |

The App asks for nothing more. It opens no pull request: a proposal is a commit
on the branch `i18n/<language>`, and a publication is a commit on the base
branch of the repository.

It has **no webhook**. The editor reads GitHub when a person opens a page, and
it never waits for an event. The manifest switches the webhook off.

## Create it

[`github-app.json`](github-app.json) is a manifest for the
[manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
of GitHub. The flow creates the App with these permissions, and gives back its
ID and its private key in one step.

1. Change `name` if the name is taken: the name of an App is unique on GitHub.
   Change `redirect_url` to a page that you control. GitHub sends the browser
   there with a `code` after the creation.
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
     | jq '{id, slug, pem}'
   ```

4. Give the two values to the API:

   | Variable                  | Value               |
   | ------------------------- | ------------------- |
   | `I18N_GITHUB_APP_ID`      | `id` of the answer  |
   | `I18N_GITHUB_PRIVATE_KEY` | `pem` of the answer |

   The answer also holds a client secret and a webhook secret. The editor does
   not use them. Keep the private key out of the repository.

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
