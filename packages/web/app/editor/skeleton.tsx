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
