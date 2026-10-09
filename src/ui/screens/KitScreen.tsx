import { Inbox, Plus } from "lucide-react";
import { useState } from "react";
import { DEMO_DECK } from "../../lib/demoDeck";
import { DEMO_DECK_2 } from "../../lib/demoDeck2";
import type { Translator } from "../../lib/i18n";
import { Button } from "../primitives/Button";
import { Chip } from "../primitives/Chip";
import { EmptyState } from "../primitives/EmptyState";
import { Panel } from "../primitives/Panel";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { SettingRow, Switch } from "../primitives/SettingRow";
import { Sheet } from "../primitives/Sheet";
import { Skeleton } from "../primitives/Skeleton";
import { StatBlock } from "../primitives/StatBlock";
import { DeckTileV2 } from "./DeckTileV2";
import { DeckHero } from "./lobby/DeckHero";

type View = "today" | "week" | "all";

/**
 * Galeria das primitivas (UX_REWRITE_PLAN §5 H-05/H-06). Só renderiza com ?ui=2&screen=_kit;
 * o gate e2e:ui2 a mede nos 5 viewports. Regra do kit: um botão primary por tela.
 */
export function KitScreen({ t }: { t: Translator }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<View>("today");
  const [turnAlerts, setTurnAlerts] = useState(true);
  const [tileSelected, setTileSelected] = useState(false);
  const [tileFavorite, setTileFavorite] = useState(false);
  const closeSheet = () => setSheetOpen(false);

  return (
    <main className="nf-kit" data-screen="_kit">
      <header className="nf-kit-head">
        <h1>{t("ui.kit.title")}</h1>
        <p className="nf-kit-note">{t("ui.kit.note")}</p>
      </header>

      <section className="nf-kit-section" aria-labelledby="nf-kit-buttons">
        <h2 id="nf-kit-buttons">{t("ui.kit.buttons")}</h2>
        <div className="nf-kit-row">
          <Button variant="primary">{t("ui.kit.primary")}</Button>
          <Button>{t("ui.kit.secondary")}</Button>
          <Button variant="ghost">{t("ui.kit.ghost")}</Button>
          <Button variant="danger">{t("ui.kit.danger")}</Button>
        </div>
        <div className="nf-kit-row">
          <Button size="sm">{t("ui.kit.dense")}</Button>
          <Button size="lg">{t("ui.kit.large")}</Button>
          <Button disabled>{t("ui.kit.disabled")}</Button>
          <Button icon={<Plus size={20} />} aria-label={t("ui.kit.add")} />
          <Button size="sm" icon={<Plus size={16} />} aria-label={t("ui.kit.add")} />
        </div>
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-chips">
        <h2 id="nf-kit-chips">{t("ui.kit.chips")}</h2>
        <div className="nf-kit-row">
          <Chip>{t("ui.kit.chip.neutral")}</Chip>
          <Chip tone="amber">{t("ui.kit.chip.amber")}</Chip>
          <Chip tone="ether">{t("ui.kit.chip.ether")}</Chip>
          <Chip tone="ember">{t("ui.kit.chip.ember")}</Chip>
          <Chip tone="verdant">{t("ui.kit.chip.verdant")}</Chip>
        </div>
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-panels">
        <h2 id="nf-kit-panels">{t("ui.kit.panels")}</h2>
        <div className="nf-kit-grid">
          <Panel>{t("ui.kit.panel.floor")}</Panel>
          <Panel tone="s2">{t("ui.kit.panel.raised")}</Panel>
          <Panel tone="s3" as="section" aria-label={t("ui.kit.panel.floor")}>{t("ui.kit.panel.top")}</Panel>
        </div>
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-stats">
        <h2 id="nf-kit-stats">{t("ui.kit.stats")}</h2>
        <div className="nf-kit-grid">
          <StatBlock tone="amber" label={t("ui.kit.stat.aember")} value="12" hint={t("ui.kit.stat.aemberHint")} />
          <StatBlock label={t("ui.kit.stat.hand")} value="6" />
          <StatBlock tone="ether" label={t("ui.kit.stat.keys")} value="2/3" hint={t("ui.kit.stat.keysHint")} />
        </div>
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-sheets">
        <h2 id="nf-kit-sheets">{t("ui.kit.sheets")}</h2>
        <div className="nf-kit-row">
          <Button data-kit="sheet-trigger" onClick={() => setSheetOpen(true)}>{t("ui.kit.sheet.open")}</Button>
        </div>
        <Sheet
          open={sheetOpen}
          onClose={closeSheet}
          title={t("ui.kit.sheet.title")}
          t={t}
          footer={(
            <>
              <Button variant="ghost" onClick={closeSheet}>{t("ui.kit.sheet.cancel")}</Button>
              <Button onClick={closeSheet}>{t("ui.kit.sheet.done")}</Button>
            </>
          )}
        >
          <p className="nf-kit-note">{t("ui.kit.sheet.body")}</p>
        </Sheet>
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-seg">
        <h2 id="nf-kit-seg">{t("ui.kit.segmented")}</h2>
        <SegmentedControl<View>
          label={t("ui.kit.seg.label")}
          value={view}
          onChange={setView}
          options={[
            { value: "today", label: t("ui.kit.seg.today") },
            { value: "week", label: t("ui.kit.seg.week") },
            { value: "all", label: t("ui.kit.seg.all") },
          ]}
        />
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-settings">
        <h2 id="nf-kit-settings">{t("ui.kit.settings")}</h2>
        <SettingRow
          title={t("ui.kit.setting.title")}
          description={t("ui.kit.setting.desc")}
          control={<Switch checked={turnAlerts} onChange={setTurnAlerts} label={t("ui.kit.setting.title")} />}
        />
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-empty">
        <h2 id="nf-kit-empty">{t("ui.kit.empty")}</h2>
        <EmptyState
          icon={<Inbox size={28} />}
          title={t("ui.kit.empty.title")}
          body={t("ui.kit.empty.body")}
          action={<Button variant="secondary">{t("ui.kit.empty.action")}</Button>}
        />
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-skeleton">
        <h2 id="nf-kit-skeleton">{t("ui.kit.skeleton")}</h2>
        <p className="nf-kit-note">{t("ui.kit.skeleton.status")}</p>
        <div className="nf-kit-grid">
          <Skeleton height="2.5em" shape="block" />
          <Skeleton height="2.5em" shape="block" />
          <Skeleton height="2.5em" shape="block" />
        </div>
        <div className="nf-kit-row">
          <Skeleton width="2.5em" height="2.5em" shape="circle" />
          <Skeleton width="60%" height="1em" />
        </div>
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-hero">
        <h2 id="nf-kit-hero">{t("ui.kit.hero")}</h2>
        <DeckHero deck={DEMO_DECK} t={t} heading="h2" />
      </section>

      <section className="nf-kit-section" aria-labelledby="nf-kit-tiles">
        <h2 id="nf-kit-tiles">{t("ui.kit.tiles")}</h2>
        <div className="nf-kit-grid">
          <DeckTileV2
            deck={DEMO_DECK}
            t={t}
            variant="mine"
            selected={tileSelected}
            tag={t("deck.savedOffline")}
            favorite={tileFavorite}
            onSelect={() => setTileSelected((value) => !value)}
            onPlay={() => undefined}
            onInspect={() => undefined}
            onToggleFavorite={() => setTileFavorite((value) => !value)}
            onRemove={() => undefined}
          />
          <DeckTileV2
            deck={DEMO_DECK_2}
            t={t}
            variant="vault"
            tag={t("ui.kit.tile.vaultTag")}
            onSelect={() => undefined}
            onPlay={() => undefined}
            onInspect={() => undefined}
          />
        </div>
      </section>
    </main>
  );
}
