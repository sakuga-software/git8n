import type { PublishMode, PublishPull } from '@i18n-editor/mcp/api';

/**
 * How the page names the publication of a repository (DB-606), with no React,
 * so a test reads it directly.
 */

export const PUBLISH_MODE_LABEL: Record<PublishMode, string> = {
  commit: 'Commit direct',
  pull_request: 'Pull request',
};

/** The tone of a mark: the colours the editor already gives a state. */
export type PullTone = 'proposed' | 'published' | 'muted' | 'alarm';

/**
 * The mark of the pull request of the publications.
 *
 * An open one that GitHub cannot merge is named before anything else: a
 * reviewer who publishes into it adds to a pull request nobody can merge.
 */
export const pullLabelOf = (pull: PublishPull | null): { text: string; tone: PullTone } => {
  if (!pull) return { text: 'Aucune pull request', tone: 'muted' };
  if (pull.state === 'merged') return { text: `PR #${pull.number} fusionnée`, tone: 'published' };
  if (pull.state === 'closed') return { text: `PR #${pull.number} fermée`, tone: 'muted' };
  if (pull.mergeable === false) return { text: `PR #${pull.number} en conflit`, tone: 'alarm' };

  return { text: `PR #${pull.number} ouverte`, tone: 'proposed' };
};

/** What the next publication does with the pull request, in the band of the proposals. */
export const pullNextOf = (pull: PublishPull | null, branch: string): string => {
  if (!pull) return 'La première publication ouvrira une pull request.';
  if (pull.state !== 'open') return 'La prochaine publication ouvrira une nouvelle pull request.';
  if (pull.mergeable === false)
    return `Elle est en conflit avec ${branch} : réglez le conflit sur GitHub avant de la fusionner.`;

  return "Les publications s'ajoutent à cette pull request.";
};

/** Where a publication went, in the words of its report. */
export const publishedWhere = (branch: string, pull: PublishPull | null | undefined): string =>
  pull ? `dans la PR #${pull.number}` : `sur ${branch}`;
