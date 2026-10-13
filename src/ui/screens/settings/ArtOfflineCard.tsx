import { useCallback, useEffect, useState } from "react";
import { Download, LoaderCircle, Trash2 } from "lucide-react";
import { listCachedDecks, type LibraryDeck } from "../../../lib/cache";
import type { Translator } from "../../../lib/i18n";
import {
  ART_QUOTA_COST_BYTES,
  ART_REAL_BYTES,
  artStatusOf,
  artUrlsOf,
  estimateArtQuota,
  formatBytes,
  type ArtStatus,
} from "../../lib/artOffline";
import { artWorkerAvailable, checkArt, clearArt, storageEstimate, warmArt } from "../../lib/artOfflineClient";
import { Button } from "../../primitives/Button";
import { Chip, type ChipTone } from "../../primitives/Chip";

const STATUS_TONE: Record<ArtStatus, ChipTone> = { none: "neutral", partial: "amber", full: "verdant" };
const STATUS_KEY = {
  none: "ui.settings.art.status.none",
  partial: "ui.settings.art.status.partial",
  full: "ui.settings.art.status.full",
} as const;

interface DeckRow {
  deck: LibraryDeck;
  urls: string[];
  present: number;
  status: ArtStatus;
}

/**
 * ART_OFFLINE (Ajustes › Dados): artes de cada deck guardadas no cache do service worker,
 * SÓ quando o jogador pede. O aviso de custo fica sempre visível: cada arte opaca conta
 * ~7 MB na quota do navegador, embora o arquivo real tenha ~150 KB.
 */
export function ArtOfflineCard({ t }: { t: Translator }) {
  const locale = t("meta.locale");
  const [rows, setRows] = useState<DeckRow[] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [cached, setCached] = useState(0);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [running, setRunning] = useState<{ key: string; done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const decks = await listCachedDecks();
    const all = [...new Set(decks.flatMap((deck) => artUrlsOf(deck.cards)))];
    const present = await checkArt(all);
    const have = new Map(all.map((url, index) => [url, present?.[index] === true]));
    setRows(decks.map((deck) => {
      const urls = artUrlsOf(deck.cards);
      const flags = urls.map((url) => have.get(url) === true);
      return { deck, urls, present: flags.filter(Boolean).length, status: artStatusOf(flags) };
    }));
    setAvailable(await artWorkerAvailable());
    setCached(present ? present.filter(Boolean).length : 0);
    setUsage(await storageEstimate());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const download = async (row: DeckRow) => {
    if (running) return;
    setNote(null);
    setRunning({ key: row.deck.id, done: 0, total: row.urls.length });
    let failed = 0;
    const ok = await warmArt(row.deck.id, row.urls, (progress) => {
      failed = progress.failed;
      setRunning({ key: row.deck.id, done: progress.done, total: progress.total });
    });
    setRunning(null);
    if (!ok) setNote(t("ui.settings.art.stalled"));
    else if (failed > 0) setNote(t("ui.settings.art.failed", { count: failed }));
    await refresh();
  };

  const clear = async () => {
    setNote(null);
    await clearArt();
    await refresh();
  };

  const disabledAll = available !== true || running !== null;

  return (
    <section className="u-settings-card u-art" aria-labelledby="u-art-title">
      <h2 className="nf-setting-title" id="u-art-title">{t("ui.settings.art.title")}</h2>
      <p className="nf-setting-desc">{t("ui.settings.art.hint")}</p>
      <p className="u-settings-note">
        {t("ui.settings.art.cost", { quota: formatBytes(ART_QUOTA_COST_BYTES, locale), real: formatBytes(ART_REAL_BYTES, locale) })}
      </p>
      {available === false && <p className="u-settings-note">{t("ui.settings.art.unavailable")}</p>}
      <div className="u-settings-actions">
        <Chip tone="neutral">
          {t("ui.settings.art.total", { count: cached.toLocaleString(locale), quota: formatBytes(estimateArtQuota(cached), locale) })}
        </Chip>
        <Button variant="ghost" icon={<Trash2 size={15} />} disabled={disabledAll || cached === 0} onClick={() => void clear()}>
          {t("ui.settings.art.clear")}
        </Button>
      </div>
      {usage && (
        <p className="nf-setting-desc">
          {t("ui.settings.art.usage", { used: formatBytes(usage.usage, locale), quota: formatBytes(usage.quota, locale) })}
        </p>
      )}
      {rows?.length === 0 && <p className="nf-setting-desc">{t("ui.settings.art.empty")}</p>}
      {rows && rows.length > 0 && (
        <ul className="u-art-list">
          {rows.map((row) => {
            const busy = running?.key === row.deck.id;
            return (
              <li className="u-art-row" key={row.deck.id}>
                <span className="u-art-name">{row.deck.name}</span>
                <Chip tone={STATUS_TONE[row.status]}>{t(STATUS_KEY[row.status])}</Chip>
                <span className="nf-setting-desc">{row.present}/{row.urls.length}</span>
                <Button
                  variant="secondary"
                  icon={busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
                  disabled={disabledAll || row.urls.length === 0 || row.status === "full"}
                  onClick={() => void download(row)}
                >
                  {busy && running
                    ? t("ui.settings.art.downloading", { done: running.done, total: running.total })
                    : t("ui.settings.art.download")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {note && <p className="u-settings-note" role="status">{note}</p>}
    </section>
  );
}
