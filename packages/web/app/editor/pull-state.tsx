import { ToggleButton } from '@heroui/react/toggle-button';
import { ToggleButtonGroup } from '@heroui/react/toggle-button-group';
import type { PublishMode, PublicationState } from '@i18n-editor/mcp/api';
import { PUBLISH_MODE_LABEL, pullLabelOf, type PullTone } from './publication';
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
 * The pull request of the publications, in the header.
 *
 * A refusal of GitHub for a permission the installation lacks is shown here
 * too, before a reviewer meets it on a publication.
 */
export function PullState({ read, onRetry }: { read: Read<PublicationState>; onRetry: () => void }) {
  if (read.state === 'loading') return null;

  if (read.state === 'failed') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={read.error.message}
        className={`inline-flex h-7 cursor-pointer items-center rounded-full border px-2.5 text-xs font-medium ${TONE.alarm}`}
      >
        {read.error.status === 503 ? 'Permission « Pull requests » manquante' : 'PR illisible · réessayer'}
      </button>
    );
  }

  const pull = read.value.pullRequest;
  const { text, tone } = pullLabelOf(pull);
  const className = `inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium no-underline ${TONE[tone]}`;

  return pull ? (
    <a href={pull.url} target="_blank" rel="noreferrer" className={className}>
      {text}
    </a>
  ) : (
    <span className={className}>{text}</span>
  );
}
