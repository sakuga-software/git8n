import { useEffect, useState } from 'react';
import { DEMO_NOTE } from './install';

const NOTE_MS = 6000;

/** The mark of the demo: nothing leaves the page, and a reset starts it again. */
export default function DemoChrome() {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: Event) => {
      setNote((event as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setNote(null), NOTE_MS);
    };

    window.addEventListener(DEMO_NOTE, show);

    return () => {
      window.removeEventListener(DEMO_NOTE, show);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed top-2 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      <div
        role="status"
        className="border-line text-sub pointer-events-auto flex items-center gap-3 rounded-full border bg-white px-3 py-1 text-xs shadow-sm"
      >
        <span>
          <strong className="text-ink font-semibold">Démo</strong> — rien n'est envoyé à GitHub
        </span>
        <button
          type="button"
          className="hover:text-signal cursor-pointer underline"
          onClick={() => window.location.assign(import.meta.env.BASE_URL)}
        >
          Réinitialiser
        </button>
      </div>
      {note && (
        <p
          role="status"
          className="bg-ink pointer-events-auto max-w-md rounded-md px-3 py-2 text-center text-xs text-white shadow"
        >
          {note}
        </p>
      )}
    </div>
  );
}
