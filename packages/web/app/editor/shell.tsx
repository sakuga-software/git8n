import { Dropdown } from '@heroui/react/dropdown';
import { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { signOut, useSession } from '~/utils/auth-client';
import { ChevronDown, Lock, Wrench } from '~/editor/icons';
import { SignIn } from '~/editor/sign-in';
import { Blocked, Failure, Loading } from '~/editor/states';
import { readsFor, type ReadError } from '~/editor/use-read';

/**
 * The frame of every page once signed in: the header with the brand and the
 * account, and the side panel. The table of a repository and the list of the
 * repositories draw in it (DB-610).
 */

/**
 * Asks before an action that drops what was typed and not proposed.
 * It answers yes at once when nothing waits.
 */
export const mayLeave = (waiting: number): boolean =>
  waiting === 0 ||
  window.confirm(
    waiting > 1
      ? `${waiting} traductions ne sont pas encore proposées. Elles seront perdues. Continuer ?`
      : "Une traduction n'est pas encore proposée. Elle sera perdue. Continuer ?",
  );

/** « CL » for Camille Laurent, and one letter for an address. */
const initialsOf = (account: string): string =>
  account
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

/**
 * The places of the frame that the editor fills once it knows what it reads:
 * the project beside the brand, and the side panel.
 *
 * The frame is drawn before the account is read, so that a failure or a
 * refusal sits in the same page as the table does. The editor reaches these
 * places with a portal.
 */
export interface Slots {
  project: HTMLElement | null;
  side: HTMLElement | null;
  /** The side panel is a rail of language codes. */
  folded: boolean;
  setFolded: (folded: boolean) => void;
}

export const ShellSlots = createContext<Slots>({ project: null, side: null, folded: false, setFolded: () => {} });

const FOLDED = 'i18n.side-panel.folded';

/** How long the panel marks its new content to fade in. `app.css` holds the durations. */
const SWAP_MS = 400;

/** The choice of the person, kept by the browser. A browser that refuses the storage keeps the panel open. */
const foldedAtStart = (): boolean => {
  try {
    return window.localStorage.getItem(FOLDED) === '1';
  } catch {
    return false;
  }
};

export function Shell({
  account,
  waiting,
  children,
}: {
  account: string;
  /** How many translations are typed and not proposed. */
  waiting: React.RefObject<number>;
  children: React.ReactNode;
}) {
  const [project, setProject] = useState<HTMLElement | null>(null);
  const [side, setSide] = useState<HTMLElement | null>(null);
  const [folded, setFoldedState] = useState(foldedAtStart);
  // A fold that the person asks for fades in each block of the panel for SWAP_MS, also a block that mounts in that time.
  // After it, a block that mounts appears at once.
  const [swap, setSwap] = useState<'folded' | 'unfolded' | null>(null);
  const swapEnd = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(swapEnd.current), []);

  const slots = useMemo(
    () => ({
      project,
      side,
      folded,
      setFolded: (next: boolean) => {
        setFoldedState(next);
        setSwap(next ? 'folded' : 'unfolded');
        window.clearTimeout(swapEnd.current);
        swapEnd.current = window.setTimeout(() => setSwap(null), SWAP_MS);

        try {
          window.localStorage.setItem(FOLDED, next ? '1' : '0');
        } catch {
          // The panel still folds. Only the next visit forgets it.
        }
      },
    }),
    [project, side, folded],
  );

  return (
    <div className="flex min-h-screen flex-col bg-white md:h-dvh md:min-h-0">
      <header className="border-line shrink-0 border-b bg-white">
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <Link
              to="/"
              onClick={(event) => {
                if (!mayLeave(waiting.current)) event.preventDefault();
              }}
              className="text-ink hover:text-ink flex items-center gap-2.5 no-underline"
            >
              <span
                aria-hidden="true"
                className="bg-ink inline-flex size-7 items-center justify-center rounded-[7px] font-mono text-[10px] font-medium text-white"
              >
                i18n
              </span>
              <span className="text-base font-semibold tracking-[-0.01em]">Traductions</span>
            </Link>
            <span aria-hidden="true" className="bg-line h-5 w-px" />
            <div ref={setProject} className="flex flex-wrap items-center gap-x-4 gap-y-2 empty:hidden" />
          </div>

          <Dropdown>
            <Dropdown.Trigger
              aria-label={`Mon compte, ${account}`}
              className="hover:bg-hover inline-flex h-9 cursor-pointer items-center gap-2 rounded-full pr-1.5 pl-1 text-sm"
            >
              <span
                aria-hidden="true"
                className="bg-hover text-sub inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold"
              >
                {initialsOf(account)}
              </span>
              {account}
              <ChevronDown size={16} className="text-muted" />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                aria-label="Mon compte"
                onAction={(key) => {
                  if (key === 'sign-out' && mayLeave(waiting.current)) void signOut();
                }}
              >
                <Dropdown.Item id="sign-out" textValue="Se déconnecter">
                  Se déconnecter
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </header>

      <div className="flex flex-wrap items-stretch md:min-h-0 md:flex-1 md:flex-nowrap">
        {/* The panel takes no room while the editor has put nothing in it. */}
        <aside
          ref={setSide}
          aria-label="Langues et fichiers"
          data-swap={swap ?? undefined}
          className={`side-panel border-line bg-side flex min-w-0 flex-col gap-[22px] overflow-x-hidden border-r pt-3.5 pb-5 empty:hidden md:relative md:overflow-y-auto motion-safe:md:transition-[flex-basis] motion-safe:md:duration-220 motion-safe:md:ease-[cubic-bezier(0.25,1,0.5,1)] ${
            folded ? 'flex-[0_0_60px] px-2.5' : 'flex-[1_1_264px] px-3'
          }`}
        />
        {/* The inner column keeps its blocks at their own height: a flex item that scrolls would shrink. */}
        <main className="relative min-w-0 flex-[999_1_560px] md:overflow-y-auto">
          <div className="flex min-h-full flex-col gap-5 px-8 pt-6 pb-10">
            <ShellSlots value={slots}>{children}</ShellSlots>
          </div>
        </main>
      </div>
    </div>
  );
}

/** What stops the page before the table, by the status of the read that failed. */
export function AccountFailure({ error, onRetry }: { error: ReadError; onRetry: () => void }) {
  if (error.status === 403) {
    return (
      <Blocked icon={<Lock size={18} />}>
        <p className="text-sm leading-normal">Ce compte n'administre pas et ne traduit aucune langue.</p>
        <button
          type="button"
          onClick={() => signOut()}
          className="hover:text-signal cursor-pointer text-[13px] underline"
        >
          Se déconnecter
        </button>
      </Blocked>
    );
  }

  if (error.status === 503) {
    return (
      <Blocked icon={<Wrench size={18} />}>
        <p className="text-sm leading-normal">L'outil de traduction n'est pas encore configuré.</p>
        <p className="text-muted max-w-xl font-mono text-xs break-words">{error.message}</p>
      </Blocked>
    );
  }

  return <Failure title="Le compte n'a pas pu être lu." error={error} onRetry={onRetry} />;
}

/**
 * A page behind the sign-in. It imports the client of better-auth, which needs
 * the address of the API. `waiting` counts what is typed and not proposed, so
 * the header asks before it drops it.
 */
export function Signed({
  children,
}: {
  children: (props: { account: string; waiting: React.RefObject<number> }) => React.ReactNode;
}) {
  const session = useSession();
  const waiting = useRef(0);

  // This runs before the pages read the cache in this render: an effect would run after them, too late.
  if (!session.isPending) readsFor(session.data?.user.id ?? null);

  if (session.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading>Lecture de la session…</Loading>
      </div>
    );
  }

  if (!session.data) return <SignIn />;

  const account = session.data.user.name || session.data.user.email;

  return (
    <Shell account={account} waiting={waiting}>
      {children({ account, waiting })}
    </Shell>
  );
}
