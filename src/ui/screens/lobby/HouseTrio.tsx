import { HouseIcon } from "../../../components/HouseIcon";
import { houseLabel } from "../../../lib/houses";
import type { Translator } from "../../../lib/i18n";

/**
 * As casas do deck com o nome ao lado do emblema: o ícone dá a forma, o texto dá a
 * informação (estado nunca é só cor — UX_REWRITE_PLAN §1.1). Um KeyForge tem 3 casas.
 */
export function HouseTrio({ houses, t }: { houses: string[]; t: Translator }) {
  return (
    <ul className="nf-trio" aria-label={t("ui.lobby.houses")}>
      {houses.slice(0, 3).map((house) => (
        <li key={house} className="nf-trio-item">
          <HouseIcon house={house} size="md" />
          <span>{houseLabel(house, t)}</span>
        </li>
      ))}
    </ul>
  );
}
