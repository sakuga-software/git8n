import { Alert as AlertBox } from '@heroui/react/alert';
import { Button } from '@heroui/react/button';
import { Spinner } from '@heroui/react/spinner';
import { Alert, Refused, Retry } from './icons';
import type { ReadError } from './use-read';

/** Something is on its way. Centred in the room it is given, and drawn only if the wait lasts. */
export function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="waited text-sub flex items-center justify-center gap-2.5 px-4 py-16 text-sm">
      <Spinner size="sm" color="current" />
      {children}
    </div>
  );
}

/**
 * A read or a write that failed, with what the API said.
 *
 * Never drawn as an empty list (DB-206): the title says what did not happen,
 * and the message of the API stays as it came.
 */
export function Failure({
  title,
  error,
  onRetry,
  written = false,
}: {
  title: string;
  error: ReadError;
  onRetry?: () => void;
  /** A write that failed takes the cross. A read takes the exclamation mark. */
  written?: boolean;
}) {
  const Mark = written ? Refused : Alert;

  return (
    // The colours stay those of the editor: the block of HeroUI is the structure and the role.
    <AlertBox
      status="danger"
      role="alert"
      className="arrive border-alarm-line bg-alarm flex items-start gap-3 rounded-lg border p-4 shadow-none"
    >
      <Mark size={20} className="text-alarm-strong" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <strong className="text-alarm-ink text-sm font-semibold">{title}</strong>
        <code className="border-alarm-soft text-alarm-code rounded-[5px] border bg-white px-2 py-1.5 font-mono text-[12.5px] break-words">
          {error.message}
        </code>
        {onRetry && (
          <div>
            <Button size="sm" onPress={onRetry}>
              <Retry />
              Réessayer
            </Button>
          </div>
        )}
      </div>
    </AlertBox>
  );
}

/** The page cannot go further, and says why under an icon. */
export function Blocked({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-24 text-center">
      <span className="text-sub inline-flex size-10 items-center justify-center rounded-full bg-[#F3F4F6]">{icon}</span>
      {children}
    </div>
  );
}
