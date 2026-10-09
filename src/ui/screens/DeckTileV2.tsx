import { Check, Eye, MoreHorizontal, Star, Swords, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { CardArt } from "../../components/CardArt";
import { coverageCounts } from "../../components/CoverageBadge";
import { HouseRow } from "../../components/HouseIcon";
import type { DeckInfo } from "../../lib/game";
import type { Translator } from "../../lib/i18n";
import { houseColor } from "../../lib/houses";
import { Button } from "../primitives/Button";
import { cx } from "../primitives/cx";

/** mine = biblioteca local (tem favorito e remover); vault = catálogo (adota ao jogar). */
export type DeckTileVariant = "mine" | "vault";

export interface DeckTileV2Props {
  deck: DeckInfo;
  t: Translator;
  variant: DeckTileVariant;
  selected?: boolean;
  tag?: string;
  favorite?: boolean;
  /** Tocar na arte/nome escolhe o deck (o hero da tela segue). */
  onSelect: () => void;
  /** Botão Jogar do tile: o caminho de 2 toques (tile → Jogar → Manter). */
  onPlay?: () => void;
  onInspect?: () => void;
  onToggleFavorite?: () => void;
  onRemove?: () => void;
}

/**
 * Tile da v2 (UX_REWRITE_PLAN §5 H-11). Dois botões de ação visíveis (Jogar e Detalhes) e o
 * ⋯ para o que é destrutivo ou secundário. Os botões ficam FORA do botão de seleção: botão
 * dentro de botão é inválido no HTML e quebra o foco.
 */
export function DeckTileV2({ deck, t, variant, selected = false, tag, favorite = false, onSelect, onPlay, onInspect, onToggleFavorite, onRemove }: DeckTileV2Props) {
  const total = deck.cards.length;
  const { full } = coverageCounts(deck.cards);
  const hasMenu = variant === "mine" && Boolean(onToggleFavorite || onRemove);

  return (
    <article className={cx("nf-tile", `nf-tile--${variant}`, selected && "is-selected")}>
      <button type="button" className="nf-tile-select" aria-pressed={selected} onClick={onSelect}>
        <span className="nf-tile-art" style={{ "--house-color": houseColor(deck.houses?.[0] ?? "Logos") } as CSSProperties}>
          <CardArt face={deck.cards[0]} size="preview" />
          {selected && <span className="nf-tile-check"><Check size={13} /></span>}
        </span>
        <span className="nf-tile-copy">
          {tag && <span className="nf-tile-tag">{tag}</span>}
          <span className="nf-tile-name" title={deck.name}>{deck.name}</span>
          <HouseRow houses={deck.houses ?? []} />
          <span className="nf-tile-meta">{total} {t("common.cards")} · {t("coverage.deck", { full, total })}</span>
        </span>
      </button>

      <div className="nf-tile-actions">
        {onPlay && <Button variant="secondary" icon={<Swords size={16} />} onClick={onPlay}>{t("ui.tile.play")}</Button>}
        {onInspect && <Button variant="ghost" icon={<Eye size={18} />} aria-label={t("ui.tile.details")} onClick={onInspect} />}
        {hasMenu && (
          <TileMenu
            t={t}
            name={deck.name}
            favorite={favorite}
            onToggleFavorite={onToggleFavorite}
            onRemove={onRemove}
          />
        )}
      </div>
    </article>
  );
}

/**
 * Menu ⋯ do tile: favorito e remover. Esc e o clique fora fecham e devolvem o foco ao ⋯;
 * setas movem entre os itens (role=menu). O toque tem o mesmo caminho do mouse.
 */
function TileMenu({ t, name, favorite, onToggleFavorite, onRemove }: {
  t: Translator;
  name: string;
  favorite: boolean;
  onToggleFavorite?: () => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    wrap.current?.querySelector<HTMLButtonElement>(".nf-tile-more-trigger")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // close só lê refs e setState estáveis: o efeito depende só de `open`.
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="nf-tile-more" ref={wrap}>
      <Button
        className="nf-tile-more-trigger"
        variant="ghost"
        icon={<MoreHorizontal size={18} />}
        aria-label={t("ui.tile.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div role="menu" className="nf-tile-menu" aria-label={name} onKeyDown={onMenuKey}>
          {onToggleFavorite && (
            <button
              type="button"
              role="menuitem"
              className="nf-tile-menuitem"
              onClick={() => { close(); onToggleFavorite(); }}
            >
              <Star size={15} fill={favorite ? "currentColor" : "none"} />
              <span>{favorite ? t("deck.favoriteRemove") : t("deck.favoriteAdd")}</span>
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              role="menuitem"
              className="nf-tile-menuitem nf-tile-menuitem--danger"
              onClick={() => { close(); onRemove(); }}
            >
              <Trash2 size={15} />
              <span>{t("deck.removeConfirm")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
