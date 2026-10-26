import { Link, useParams } from 'react-router';
import { Wrench } from '~/editor/icons';
import { Signed } from '~/editor/shell';
import { Blocked } from '~/editor/states';

export const meta = () => [{ title: 'Réglages · Traductions' }];

/** The settings of one repository. DB-609 fills this page; it only leads back for now. */
export default function RepositorySettingsRoute() {
  const { id = '' } = useParams();

  return (
    <Signed>
      {() => (
        <Blocked icon={<Wrench size={18} />}>
          <p className="text-sm leading-normal">Les réglages de ce dépôt arrivent bientôt.</p>
          <Link to={`/repositories/${encodeURIComponent(id)}`} className="hover:text-signal text-[13px] underline">
            Revenir au tableau
          </Link>
        </Blocked>
      )}
    </Signed>
  );
}
