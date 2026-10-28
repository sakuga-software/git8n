import { ToggleButton } from '@heroui/react/toggle-button';
import { ToggleButtonGroup } from '@heroui/react/toggle-button-group';
import type { PublishMode, PublicationState } from '@git8n/mcp/api';
import { External, Retry } from './icons';
import { PUBLISH_MODE_LABEL, pullLabelOf, pullNextOf, type PullTone } from './publication';
import type { Read } from './use-read';

/** The two ways a repository publishes (DB-606). */
export function PublishModeSwitch({
  value,
  onChange,
  isDisabled,
  label = 'Publier par',
}: {
  value: PublishMode;
  onChange: (mode: PublishMode) => void;
  isDisabled?: boolean;
  label?: string;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      isDisabled={isDisabled}
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [next] = [...keys];

        if (next) onChange(next as PublishMode);
      }}
      className="switch"
    >
      <ToggleButton id="commit">{PUBLISH_MODE_LABEL.commit}</ToggleButton>
      <ToggleButton id="pull_request">{PUBLISH_MODE_LABEL.pull_request}</ToggleButton>
    </ToggleButtonGroup>
  );
}

const TONE: Record<PullTone, string> = {
  proposed: 'bg-proposed border-proposed-line text-proposed-ink',
  published: 'bg-published border-published-line text-published-ink',
  muted: 'bg-panel border-line text-sub',
  alarm: 'bg-alarm border-alarm-line text-alarm-strong',
};

/**
 * The pull request of the publications, at the top of the proposals (DB-627).
 *
 * A refusal of GitHub for a permission the installation lacks is shown here
 * too, before a reviewer meets it on a publication.
 */
export function PullBand({
  read,
  branch,
  onRetry,
}: {
  read: Read<PublicationState>;
  branch: string;
  onRetry: () => void;
}) {
  if (read.state === 'loading') return null;

  const band = 'border-line flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-[13px]';
  const mark = 'inline-flex h-6 flex-none items-center rounded-full border px-2.5 text-xs font-medium no-underline';

  if (read.state === 'failed') {
    return (
      <section aria-label="Pull request des publications" className={band}>
        <span className={`${mark} ${TONE.alarm}`}>
          {read.error.status === 503 ? 'Permission « Pull requests » manquante' : 'PR illisible'}
        </span>
        <span className="text-sub min-w-[200px] flex-1" title={read.error.message}>
          {read.error.status === 503
            ? 'La publication ne pourra pas ouvrir de pull request.'
            : "La pull request des publications n'a pas pu être lue."}
        </span>
        <button type="button" onClick={onRetry} className="link inline-flex items-center gap-1.5">
          <Retry size={14} />
          Réessayer
        </button>
      </section>
    );
  }

  const pull = read.value.pullRequest;
  const { text, tone } = pullLabelOf(pull);

  return (
    <section aria-label="Pull request des publications" className={band}>
      <span className={`${mark} ${TONE[tone]}`}>{text}</span>
      <span className="text-sub min-w-[200px] flex-1">{pullNextOf(pull, branch)}</span>
      {pull && (
        <a href={pull.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1.5">
          Ouvrir sur GitHub
          <External size={13} />
        </a>
      )}
    </section>
  );
}
