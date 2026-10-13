import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, WifiOff, X } from "lucide-react";
import type { Translator } from "../../../lib/i18n";
import type { CatalogProgress } from "../../../lib/keyforgeApi";
import { Button } from "../../primitives/Button";
import { Chip } from "../../primitives/Chip";
import { SettingRow } from "../../primitives/SettingRow";
import { readBuildId } from "./buildId";
import { ArtOfflineCard } from "./ArtOfflineCard";

/**
 * Aba Dados e offline (UX_REWRITE_PLAN §2 S7, §5 H-19): catálogo (contagem, sincronizar,
 * progresso e cancelar), status do app (BUILD_ID, atualização pronta, offline-ready,
 * ?swreset=1) e "Sincronizar deck atual" — a ação que morava no header v1. Sem texto
 * "ONLINE" fixo (S11): a conexão só aparece quando falta.
 */
export function DataTab({ t, online, catalogCount, catalogSync, onSyncCatalog, onCancelCatalog, onSyncDeck, deckSyncing, updateReady, onReloadUpdate }: {
  t: Translator;
  online: boolean;
  catalogCount: number;
  /** Sync em curso (n/total) ou null — dona: App, como no review da v1. */
  catalogSync: CatalogProgress | null;
  onSyncCatalog: () => void;
  onCancelCatalog: () => void;
  onSyncDeck: () => void;
  deckSyncing: boolean;
  /** FEAT-09: uma atualização do service worker está instalada e espera o reload. */
  updateReady: boolean;
  onReloadUpdate: () => void;
}) {
  // O BUILD_ID vem do sw.js servido (linha do status, não trava nada).
  const [buildId, setBuildId] = useState("…");
  useEffect(() => { void readBuildId().then(setBuildId); }, []);
  const pct = catalogSync && catalogSync.total > 0 ? Math.round((catalogSync.done / catalogSync.total) * 100) : 0;

  return (
    <div className="u-settings-list">
      <section className="u-settings-card" aria-labelledby="u-data-catalog-title">
        <h2 className="nf-setting-title" id="u-data-catalog-title">{t("config.catalog.title")}</h2>
        <p className="nf-setting-desc">{t("config.catalog.hint")}</p>
        <div className="u-settings-actions">
          <Chip tone="neutral">{t("catalog.chip", { count: catalogCount.toLocaleString(t("meta.locale")) })}</Chip>
          <Button
            variant="secondary"
            icon={catalogSync ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            disabled={catalogSync !== null}
            onClick={onSyncCatalog}
          >
            {catalogSync ? t("config.catalog.syncing", { done: catalogSync.done, total: catalogSync.total }) : t("config.catalog.sync")}
          </Button>
          {catalogSync && (
            <Button variant="ghost" icon={<X size={15} />} onClick={onCancelCatalog}>{t("common.cancel")}</Button>
          )}
        </div>
        {catalogSync && (
          <div
            className="u-progress"
            role="progressbar"
            aria-label={t("ui.settings.data.progress")}
            aria-valuemin={0}
            aria-valuemax={Math.max(1, catalogSync.total)}
            aria-valuenow={catalogSync.done}
          >
            <span className="u-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </section>

      <SettingRow
        title={t("ui.settings.data.syncDeck")}
        description={t("ui.settings.data.syncDeckHint")}
        control={
          <Button
            variant="secondary"
            icon={deckSyncing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            disabled={deckSyncing}
            onClick={onSyncDeck}
          >
            {deckSyncing ? t("common.syncing") : t("common.sync")}
          </Button>
        }
      />

      {/* ART_OFFLINE: artes por deck sob pedido; o custo de quota aparece no próprio card. */}
      <ArtOfflineCard t={t} />

      <section className="u-settings-card" aria-labelledby="u-data-status-title">
        <h2 className="nf-setting-title" id="u-data-status-title">{t("ui.settings.data.appStatus")}</h2>
        <div className="u-settings-status">
          <span className="nf-setting-desc">{t("ui.settings.data.build")}</span>
          <code className="u-build-id">{buildId}</code>
        </div>
        <div className="u-settings-status">
          <Chip tone="verdant">{t("rail.offlineReady")}</Chip>
        </div>
        {updateReady && (
          <div className="u-settings-status">
            {/* S11: o status da atualização (FEAT-09) também mora aqui, além do toast. */}
            <span className="nf-setting-desc">{t("update.title")}</span>
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={onReloadUpdate}>{t("update.reload")}</Button>
          </div>
        )}
        {!online && (
          <p className="u-settings-note"><WifiOff size={14} aria-hidden="true" /> {t("ui.settings.data.offline")}</p>
        )}
        <p className="u-settings-note">{t("ui.settings.data.swreset")}</p>
      </section>
    </div>
  );
}
