import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import { TextArea } from '@heroui/react/textarea';
import { useState } from 'react';
import { Info } from './icons';
import { newKeyProblem } from './rows';
import { Failure } from './states';
import { Busy, Choice } from './ui';
import type { ReadError } from './use-read';

interface Props {
  /** The files of the source, by name. */
  files: readonly string[];
  /** The files that have no version in the language on the screen. */
  disabled: ReadonlySet<string>;
  /** « anglais », for the sentence about a file with no version. */
  language: string;
  source: { name: string; code: string };
  /** The keys the source holds, by file. A file that is not read here holds none: the API still refuses. */
  existing: ReadonlyMap<string, ReadonlySet<string>>;
  /** The file that the table shows, if it shows one. The form starts there. */
  startFile: string;
  onCreate: (key: { file: string; key: string; value: string }) => Promise<void>;
  onCancel: () => void;
  /** Why the last creation failed. The fields keep what was typed. */
  error: ReadError | null;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The form that adds a key to the source language (DB-238).
 *
 * It sits in the page, above the table, and is not a dialog: the table under
 * it shows the names that the file already uses, which is what one looks at to
 * name a key.
 *
 * A key is created on the base branch at once, with no proposal. It is inert
 * until the code of the product calls it.
 */
export function NewKey({ files, disabled, language, source, existing, startFile, onCreate, onCancel, error }: Props) {
  const [file, setFile] = useState(files.includes(startFile) ? startFile : (files[0] ?? ''));
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  // The problem of a key shows after a first try, not at the first letter.
  const [tried, setTried] = useState(false);

  const problem = newKeyProblem(key, existing.get(file) ?? NO_KEYS);
  const empty = value.trim() === '';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);

    if (problem !== null || empty || busy) return;

    setBusy(true);

    try {
      await onCreate({ file, key, value });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-label="Nouvelle clé"
      className="arrive border-line-strong flex flex-col gap-4 rounded-[10px] border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Nouvelle clé</h2>
        <p className="text-muted text-xs">
          Écrite tout de suite dans le {source.name} du dépôt. Elle ne s'affiche nulle part tant que le code ne
          l'appelle pas.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="text-muted flex flex-col gap-1.5 text-xs font-medium">
          <span aria-hidden="true">Fichier</span>
          <Choice
            label="Fichier"
            value={file}
            items={files.map((name) => ({ value: name, label: name }))}
            onChange={setFile}
            className="min-w-[170px]"
          />
        </div>

        {/* The message sits beside the label, not in it: in it, the field would be named by its own error. */}
        <div className="flex min-w-[280px] flex-1 flex-col gap-1.5">
          <label className="text-muted flex flex-col gap-1.5 text-xs font-medium">
            Clé
            <Input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="section.nom_de_la_cle"
              spellCheck={false}
              autoCapitalize="none"
              autoFocus
              aria-invalid={tried && problem !== null}
              aria-describedby="new-key-problem"
              className="h-9 font-mono text-[13px]"
            />
          </label>
          <span id="new-key-problem" role="status" className="text-alarm-strong min-h-4 text-xs">
            {tried && problem}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-muted flex flex-col gap-1.5 text-xs font-medium">
          Texte · {source.name}
          <TextArea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            lang={source.code}
            rows={2}
            aria-invalid={tried && empty}
            aria-describedby="new-key-empty"
          />
        </label>
        <span id="new-key-empty" role="status" className="text-alarm-strong min-h-4 text-xs">
          {tried && empty && 'Écrivez le texte : une clé sans texte ne se traduit pas.'}
        </span>
      </div>

      {disabled.has(file) && (
        <p className="bg-panel text-sub flex items-start gap-2.5 rounded-md px-3 py-2 text-[13px] leading-normal">
          <Info size={15} className="text-muted mt-0.5" />
          {file} n'a pas de version en {language} : la clé sera créée, et ne sera pas listée dans cette langue.
        </p>
      )}

      {error && <Failure title="La clé n'a pas été créée. Rien n'a été écrit." error={error} written />}

      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="outline" onPress={onCancel} isDisabled={busy}>
          Annuler
        </Button>
        <Button type="submit" isDisabled={busy}>
          {busy ? (
            <>
              <Busy />
              Création…
            </>
          ) : (
            'Créer la clé'
          )}
        </Button>
      </div>
    </form>
  );
}
