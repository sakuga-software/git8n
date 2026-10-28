/** A block that stands for a text or a control that is on its way. */
export function Bone({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`bone block rounded ${className}`} />;
}

/**
 * The shape of a screen before its data, drawn where the data will be (DB-652).
 * A screen reader hears `label`, and nothing of the bones.
 */
export function Skeleton({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={`skeleton ${className}`}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** The rows of the list of the repositories, as the table draws them. */
export function RepositoryRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Skeleton label="Lecture des dépôts…" className="flex flex-col rounded-[10px] bg-white text-left">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="border-line-soft flex items-center gap-6 border-b px-4 py-[15px] last:border-b-0">
          <span className="flex w-56 flex-col gap-1.5">
            <Bone className="h-3.5 w-40" />
            <Bone className="h-3 w-24" />
          </span>
          <Bone className="h-2 w-48 rounded-full" />
          <Bone className="h-3 w-20" />
          <Bone className="ml-auto h-3 w-16" />
        </div>
      ))}
    </Skeleton>
  );
}

/** The settings of a repository before the account and the repositories are read. */
export function SettingsSkeleton() {
  return (
    <Skeleton label="Lecture du dépôt…" className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Bone className="h-6 w-80" />
        <Bone className="h-3.5 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[176px_minmax(0,1fr)] md:items-start md:gap-10">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Bone key={index} className="h-8 rounded-md" />
          ))}
        </div>
        <div className="flex flex-col gap-5">
          <Bone className="h-4 w-32" />
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="flex flex-col gap-2">
              <Bone className="h-3 w-28" />
              <Bone className="h-9 w-full rounded-lg" />
            </span>
          ))}
        </div>
      </div>
    </Skeleton>
  );
}

/** The members of a repository before they are read. */
export function MembersSkeleton() {
  return (
    <Skeleton label="Lecture des membres…" className="flex flex-col gap-8">
      <Bone className="h-3.5 w-full max-w-[560px]" />
      <Bone className="h-9 w-full rounded-lg" />
      <div className="flex flex-col gap-3">
        <Bone className="h-4 w-28" />
        <div className="border-line flex flex-col rounded-lg border">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="border-line-soft flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
              <Bone className="size-7 rounded-full" />
              <span className="flex flex-col gap-1.5">
                <Bone className="h-3.5 w-36" />
                <Bone className="h-3 w-24" />
              </span>
              <Bone className="ml-auto h-7 w-24 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </Skeleton>
  );
}

/** The rows of the table of the editor, in its frame, before the first read of the catalogue. */
export function KeyRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="skeleton border-line overflow-hidden rounded-[10px] border">
      <div className="border-line bg-panel flex items-center gap-6 border-b px-4 py-[11px]">
        {['w-12', 'w-24', 'w-28'].map((width) => (
          <span key={width} className="min-w-0 flex-1 basis-0">
            <Bone className={`h-3 ${width}`} />
          </span>
        ))}
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="border-line-soft flex items-start gap-6 border-b px-4 py-3.5 last:border-b-0">
          <span className="flex min-w-0 flex-1 basis-0 flex-col gap-2 pt-1">
            <Bone className="h-3.5 w-3/4" />
            <Bone className="h-3 w-16" />
          </span>
          <span className="min-w-0 flex-1 basis-0 pt-[11px]">
            <Bone className="h-3.5 w-2/3" />
          </span>
          <Bone className="h-[38px] min-w-0 flex-1 basis-0 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** The side panel of the editor before the account is read: a rail of codes, or the select of the languages. */
export function LanguagesSkeleton({ folded }: { folded: boolean }) {
  if (folded) {
    return (
      <div aria-hidden="true" className="skeleton flex flex-col items-center gap-2">
        <Bone className="size-10 rounded-md" />
        <span className="bg-line h-px w-6" />
        <Bone className="size-10 rounded-lg" />
        <Bone className="size-10 rounded-lg" />
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="skeleton flex flex-col gap-1">
      <div className="mb-1 flex h-8 items-center justify-between pl-2">
        <Bone className="h-3 w-20" />
        <Bone className="size-8 rounded-md" />
      </div>
      <Bone className="h-[62px] rounded-xl" />
    </div>
  );
}

/** The editor of a language before the account is read: the header, the tabs and the table. */
export function EditorSkeleton() {
  return (
    <Skeleton label="Lecture du compte…" className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Bone className="my-[3px] h-7 w-56" />
          <Bone className="my-1.5 h-2 w-full max-w-[640px] rounded-full" />
        </div>
        <Bone className="h-9 w-[132px] rounded-lg" />
      </div>
      <div className="border-line flex items-end justify-between gap-6 border-b">
        <span className="flex gap-6 pb-3.5">
          {Array.from({ length: 4 }, (_, index) => (
            <Bone key={index} className="h-4 w-24" />
          ))}
        </span>
        <span className="my-[5px] flex gap-2.5">
          <Bone className="h-9 w-[280px] rounded-lg" />
          <Bone className="h-9 w-[72px] rounded-lg" />
        </span>
      </div>
      <KeyRowsSkeleton />
    </Skeleton>
  );
}
