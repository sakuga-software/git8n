import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { HonoEnv } from '@/types/hono';
import { forgetRepository } from '@/utils/cache';
import { getUser } from '@/utils/context';
import { withAuth } from '@/auth';
import { authorAddressOf, mayPropose, mayPublish, mayWriteSource, rightsOf } from '@/services/i18n-rights.service';
import {
  acknowledge,
  createKeys,
  propose,
  heldProposedKeys,
  publish,
  heldWaiting,
  type Author,
} from '@/services/i18n-git.service';
import { avatarsByInstallation } from '@/services/i18n-avatars.service';
import { GithubAppNotConfiguredError, GithubError, installations, repositoriesOf } from '@/services/github-app.service';
import { getCatalogue, manifestPathOf } from '@/services/i18n-catalogue.service';
import { progressOf } from '@/services/i18n-progress.service';
import {
  addRepository,
  languagesOf,
  listRepositories,
  repositoryOrReason,
  NotOnGithubError,
  updateRepository,
  UnknownLanguageError,
  UnknownRepositoryError,
} from '@/services/i18n-repositories.service';
import { heldLastPullOf, MissingPermissionError, PublishConflictError } from '@/services/i18n-pull-request.service';
import { UnwritableKeyError } from '@/services/i18n-git.service';
import { detect } from '@/services/i18n-detection.service';
import { reachableRepositories } from '@/services/i18n-reachable.service';
import { overview } from '@/services/i18n-overview.service';
import { env } from '@/config/env';
import {
  detectionQuerySchema,
  reachableQuerySchema,
  overviewQuerySchema,
  newKeysSchema,
  newRepositorySchema,
  proposalSchema,
  publicationSchema,
  repositoryChangeSchema,
  reviewSchema,
} from '@/schemas/i18n';

const router = new Hono<HonoEnv>();

/**
 * The translations (DB-210).
 *
 * An admin or a translator may read. An admin opens the page, a translator
 * does the work, and neither is the other. Setting a repository up is for an
 * admin alone: somebody with access takes that step once, so a translator is
 * added with none.
 */
const signedIn = withAuth();

const refuseAStranger = async (c: Parameters<typeof signedIn>[0]) => {
  const user = getUser(c);

  if (user.admin === true) return;
  if (await rightsOf(user.id)) return;

  throw new HTTPException(403, { message: 'This account neither administers nor translates.' });
};

const refuseANonAdmin = (c: Parameters<typeof signedIn>[0]) => {
  if (getUser(c).admin !== true) {
    throw new HTTPException(403, { message: 'Setting a repository up is for an administrator.' });
  }
};

/**
 * Turns what nobody set up into the status the page names.
 *
 * An operator acts on a GitHub App with no secrets, and on a setup with no
 * repository. Neither is « nothing to translate ».
 */
const answer = async <T>(read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    // An installation that lacks a permission is a setup to finish, as an App
    // with no secrets is: an owner of the installation acts, not the caller.
    if (error instanceof GithubAppNotConfiguredError || error instanceof MissingPermissionError) {
      throw new HTTPException(503, { message: error.message });
    }

    if (error instanceof PublishConflictError) {
      throw new HTTPException(409, { message: error.message });
    }

    // The caller named something that is not there. A 500 would hide the list
    // of what exists.
    if (
      error instanceof UnknownRepositoryError ||
      error instanceof UnknownLanguageError ||
      error instanceof UnwritableKeyError
    ) {
      throw new HTTPException(400, { message: error.message });
    }

    throw error;
  }
};

/**
 * Does a write to a repository, then drops every answer held of it.
 *
 * The drop also runs if the write fails: a write can fail after its commit,
 * for example when the pull request is not opened.
 */
const write = async <T>(repositoryId: string, change: () => Promise<T>): Promise<T> => {
  try {
    return await answer(change);
  } finally {
    forgetRepository(repositoryId);
  }
};

/** The repositories the editor translates. */
router.get('/repositories', signedIn, async (c) => {
  await refuseAStranger(c);

  const [rows, avatars] = await Promise.all([listRepositories(), avatarsByInstallation()]);

  return c.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      owner: row.owner,
      name: row.name,
      avatarUrl: avatars.get(row.installationId) ?? null,
      branch: row.branch,
      localesPath: row.localesPath,
      manifestPath: manifestPathOf(row),
      publishMode: row.publishMode,
      proposalCommitTemplate: row.proposalCommitTemplate,
      publicationCommitTemplate: row.publicationCommitTemplate,
      pullRequestTitleTemplate: row.pullRequestTitleTemplate,
      pullRequestBodyTemplate: row.pullRequestBodyTemplate,
      ...languagesOf(row),
    })),
  });
});

/**
 * The page of every repository (DB-610): one page of them, searched and
 * sorted, with how far each language is and the pull request that waits.
 *
 * `/repositories` keeps its answer, the whole list with no progress: the MCP
 * server and the picker of the table read it.
 */
router.get('/overview', signedIn, async (c) => {
  await refuseAStranger(c);

  const { data, error, success } = overviewQuerySchema.safeParse(c.req.query());

  if (!success) throw new HTTPException(400, { message: JSON.stringify(error.issues) });

  const user = getUser(c);
  const rights = await rightsOf(user.id);
  const everyLanguage = user.admin === true || rights?.writesSource === true;

  return c.json({
    success: true,
    data: await answer(() => overview({ ...data, languages: everyLanguage ? undefined : (rights?.languages ?? []) })),
  });
});

/**
 * Changes a connected repository: its place, its languages, how it publishes
 * (DB-606) and the formats of its messages (DB-609). An absent field keeps its value.
 */
router.patch('/repositories/:id', signedIn, async (c) => {
  refuseANonAdmin(c);

  const { data, error, success } = await parsed(c, repositoryChangeSchema);

  // A refusal takes the shape of the other validation errors of the API
  // (`errorHandler`): a message, and one entry by field in `errors`. The page
  // shows each one under its field.
  if (!success) {
    const errors = error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));

    return c.json(
      {
        message: errors.map((entry) => (entry.field ? `${entry.field}: ${entry.message}` : entry.message)).join('; '),
        errors,
      },
      400,
    );
  }

  const repository = await answer(() =>
    updateRepository(c.req.param('id'), data).catch((error: unknown) => {
      if (error instanceof NotOnGithubError) return { refused: { field: error.field, message: error.message } };

      // GitHub failed to answer the check, for a reason other than a missing
      // path. The change is not written, and the reason stays readable.
      if (error instanceof GithubError) {
        throw new HTTPException(502, { message: `GitHub did not answer the check of the change: ${error.message}` });
      }

      throw error;
    }),
  );

  if ('refused' in repository) {
    return c.json({ message: repository.refused.message, errors: [repository.refused] }, 400);
  }

  return c.json({ success: true, data: { ...repository, ...languagesOf(repository) } });
});

/**
 * The pull request that carries the publications of a repository (DB-606).
 *
 * `pullRequest` is the last one, open or not, so the page says « fusionnée »
 * after a merge. A repository that publishes by commit has none.
 */
router.get('/publication', signedIn, async (c) => {
  await refuseAStranger(c);

  const repository = await answer(() => repositoryOrReason(c.req.query('repository')));

  if (repository.publishMode !== 'pull_request') {
    return c.json({ success: true, data: { publishMode: repository.publishMode, pullRequest: null } });
  }

  const pullRequest = await answer(() => heldLastPullOf(repository));

  return c.json({ success: true, data: { publishMode: repository.publishMode, pullRequest } });
});

/**
 * What the GitHub App can reach, which is how a repository is found rather
 * than typed. An admin installs the App, reads this, and adds one.
 */
router.get('/installations', signedIn, async (c) => {
  refuseANonAdmin(c);

  return c.json({
    success: true,
    data: await answer(async () => {
      const found = await installations();

      return Promise.all(
        found.map(async (installation) => ({
          ...installation,
          repositories: await repositoriesOf(installation.id),
        })),
      );
    }),
  });
});

/**
 * How a repository of an installation holds its locales, before an admin
 * connects it (DB-581): its branch, the folders that hold languages, and the
 * manifest beside them. The page fills its form with it.
 */
router.get('/detection', signedIn, async (c) => {
  refuseANonAdmin(c);

  const { data, error, success } = detectionQuerySchema.safeParse(c.req.query());

  if (!success) {
    throw new HTTPException(400, {
      message: `A detection needs installationId, owner and name. ${JSON.stringify(error.issues)}`,
    });
  }

  return c.json({ success: true, data: await answer(() => detect(data)) });
});

/**
 * The repositories the installations reach, one page at a time, for the
 * picker of the page (DB-581). `q` searches every page, not only the loaded ones.
 */
router.get('/installations/repositories', signedIn, async (c) => {
  refuseANonAdmin(c);

  const { data, error, success } = reachableQuerySchema.safeParse(c.req.query());

  if (!success) throw new HTTPException(400, { message: JSON.stringify(error.issues) });

  return c.json({
    success: true,
    data: await answer(() =>
      reachableRepositories({ page: data.page, perPage: data.perPage, q: data.q, fresh: data.fresh === '1' }),
    ),
  });
});

/** Writes down a repository to translate, and what it takes to read it. */
router.post('/repositories', signedIn, async (c) => {
  refuseANonAdmin(c);

  // A body that is not JSON is a bad request, not a failure of the server.
  const sent = await c.req.json().catch(() => undefined);
  const { data, error, success } = newRepositorySchema.safeParse(sent);

  if (!success) {
    throw new HTTPException(400, {
      message: `A repository needs installationId, owner, name, localesPath and languages, the source language first. ${JSON.stringify(error.issues)}`,
    });
  }

  const { repository, created } = await answer(() => addRepository(data));

  return c.json({ success: true, data: { ...repository, ...languagesOf(repository), created } });
});

/** Every key of the source, beside what one language says about it. */
router.get('/catalogue', signedIn, async (c) => {
  await refuseAStranger(c);

  const language = c.req.query('language');

  if (!language) {
    throw new HTTPException(400, { message: 'Name the language to read, with ?language=.' });
  }

  const repository = await answer(() => repositoryOrReason(c.req.query('repository')));

  return c.json({ success: true, data: await answer(() => getCatalogue(repository, language)) });
});

/**
 * How far each language of a repository is: published, proposed, missing (DB-268).
 *
 * An account reads the languages it can open and no other: every target for an
 * admin and for an account that writes the source, the languages of its row
 * for a translator. That is the list the editor offers it.
 */
router.get('/progress', signedIn, async (c) => {
  await refuseAStranger(c);

  const user = getUser(c);
  const rights = await rightsOf(user.id);
  const repository = await answer(() => repositoryOrReason(c.req.query('repository')));
  const all = await answer(() => progressOf(repository));
  const everyLanguage = user.admin === true || rights?.writesSource === true;

  return c.json({
    success: true,
    data: everyLanguage ? all : all.filter((row) => rights?.languages.includes(row.language)),
  });
});

/** Reads a body, or answers what is wrong with it rather than failing on it. */
const parsed = async <T>(c: Parameters<typeof signedIn>[0], schema: { safeParse: (value: unknown) => T }) => {
  // A body that is not JSON is a bad request, not a failure of the server.
  const sent = await c.req.json().catch(() => undefined);

  return schema.safeParse(sent);
};

/** Who the batch is authored by, without putting a personal address in git. */
const authorOf = (c: Parameters<typeof signedIn>[0]): Author => {
  const user = getUser(c);

  return { name: user.name, email: authorAddressOf(user.id) };
};

/**
 * Writes a batch of translations on the branch of its language.
 *
 * A proposal needs a row that names the language. An admin with no such row is
 * refused: reading the catalogue is an admin page, writing a language is a
 * grant.
 */
router.post('/proposals', signedIn, async (c) => {
  const { data, error, success } = await parsed(c, proposalSchema);

  if (!success) throw new HTTPException(400, { message: JSON.stringify(error.issues) });

  const repository = await answer(() => repositoryOrReason(data.repository));
  const rights = await rightsOf(getUser(c).id);
  // The source is proposed and published by `writes_source` alone (DB-607). A
  // grant of the source language as a target grants nothing here.
  const allowed =
    data.language === languagesOf(repository).source ? mayWriteSource(rights) : mayPropose(rights, data.language);

  if (!allowed) {
    throw new HTTPException(403, { message: `This account may not propose in ${data.language}.` });
  }

  const proposal = await write(repository.id, () =>
    propose(repository, data.language, data.values, authorOf(c), data.readAt),
  );

  return c.json({ success: true, data: proposal });
});

/** The batches that sit on the branch of a language and not on the base. */
router.get('/proposals', signedIn, async (c) => {
  await refuseAStranger(c);

  const language = c.req.query('language');

  if (!language) {
    throw new HTTPException(400, { message: 'Name the language to read, with ?language=.' });
  }

  const repository = await answer(() => repositoryOrReason(c.req.query('repository')));

  return c.json({ success: true, data: await answer(() => heldWaiting(repository, language)) });
});

/** The keys that wait on the branch of a language, with the batch a publication names for each. */
router.get('/proposals/keys', signedIn, async (c) => {
  await refuseAStranger(c);

  const language = c.req.query('language');

  if (!language) {
    throw new HTTPException(400, { message: 'Name the language to read, with ?language=.' });
  }

  const repository = await answer(() => repositoryOrReason(c.req.query('repository')));

  return c.json({ success: true, data: await answer(() => heldProposedKeys(repository, language)) });
});

/**
 * Copies approved keys from the branch of a language onto the base branch.
 *
 * Publishing needs the reviewer role on that language. A translator proposes
 * and does not publish their own work.
 */
router.post('/publications', signedIn, async (c) => {
  const { data, error, success } = await parsed(c, publicationSchema);

  if (!success) throw new HTTPException(400, { message: JSON.stringify(error.issues) });

  const repository = await answer(() => repositoryOrReason(data.repository));
  const rights = await rightsOf(getUser(c).id);
  // In the source, the account that writes it also reviews it (DB-607).
  const allowed =
    data.language === languagesOf(repository).source ? mayWriteSource(rights) : mayPublish(rights, data.language);

  if (!allowed) {
    throw new HTTPException(403, { message: `This account may not publish ${data.language}.` });
  }

  const publication = await write(repository.id, () => publish(repository, data.language, data.approved, authorOf(c)));

  return c.json({ success: true, data: publication });
});

/**
 * Keeps translations as they are, after their source changed (DB-607).
 *
 * It needs the reviewer role on the language, as a publication does: it is one.
 * A key that is not to read again is answered in `skipped`, not refused.
 */
router.post('/reviews', signedIn, async (c) => {
  const { data, error, success } = await parsed(c, reviewSchema);

  if (!success) throw new HTTPException(400, { message: JSON.stringify(error.issues) });

  const repository = await answer(() => repositoryOrReason(data.repository));

  if (!mayPublish(await rightsOf(getUser(c).id), data.language)) {
    throw new HTTPException(403, { message: `This account may not review ${data.language}.` });
  }

  const reviewed = await write(repository.id, () => acknowledge(repository, data.language, data.keys, authorOf(c)));

  return c.json({ success: true, data: reviewed });
});

/**
 * Adds keys to the source language, on the base branch (DB-238).
 *
 * It needs the right to write the source, which is a right of its own. A
 * translator, a reviewer and an admin are each refused without it.
 */
router.post('/keys', signedIn, async (c) => {
  const { data, error, success } = await parsed(c, newKeysSchema);

  if (!success) throw new HTTPException(400, { message: JSON.stringify(error.issues) });

  if (!mayWriteSource(await rightsOf(getUser(c).id))) {
    throw new HTTPException(403, { message: 'This account may not write the source language.' });
  }

  const repository = await answer(() => repositoryOrReason(data.repository));

  const created = await write(repository.id, () => createKeys(repository, data.values, authorOf(c)));

  return c.json({ success: true, data: created });
});

/** What the signed-in account may do. `null` when it translates nothing. */
router.get('/me', signedIn, async (c) => {
  const user = getUser(c);

  const admin = user.admin === true;

  return c.json({
    success: true,
    data: {
      admin,
      rights: await rightsOf(user.id),
      // Installing the App is the first step of connecting a repository, which is for an admin alone.
      installUrl: admin ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null,
    },
  });
});

export default router;
