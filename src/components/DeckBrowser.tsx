import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CloudOff, LoaderCircle, Search, Swords, WifiOff } from "lucide-react";
import type { DeckInfo } from "../lib/game";
import { fetchDeckPage } from "../lib/keyforgeApi";
import type { Translator } from "../lib/i18n";
import { sound } from "../lib/sound";
import { HouseMark, DeckTile } from "./DeckTile";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 9;

const ORDERINGS: { id: string; key: string }[] = [
  { id: "-date", key: "browse.sortNewest" },
  { id: "date", key: "browse.sortOldest" },
  { id: "name", key: "browse.sortName" },
  { id: "-power_level", key: "browse.sortPower" },
];

export function DeckBrowser({
  t,
  offline,
  onBack,
  onInspect,
  onUseDeck,
}: {
  t: Translator;
  offline: boolean;
  onBack: () => void;
  onInspect: (deck: DeckInfo) => void;
  onUseDeck: (deck: DeckInfo) => void;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [ordering, setOrdering] = useState("-date");
  const [decks, setDecks] = useState<DeckInfo[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");

    fetchDeckPage({ page, pageSize: PAGE_SIZE, search, ordering })
      .then((result) => {
        if (requestId !== requestRef.current) return;
        setDecks(result.decks);
        setCount(result.count);
      })
      .catch((cause: unknown) => {
        if (requestId !== requestRef.current) return;
        setDecks([]);
        setCount(0);
        setError(cause instanceof Error ? cause.message : t("browse.failed"));
        sound.play("error");
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });

    return () => {
      requestRef.current += 1;
    };
  }, [page, search, ordering, t]);

  const totalPages = Math.max(1, Math.min(Math.ceil(count / PAGE_SIZE), 5000));

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sound.play("click");
    setPage(1);
    setSearch(pendingSearch.trim());
  };

  return (
    <div className="screen browse-screen">
      <div className="sub-head">
        <button type="button" className="icon-back" onClick={() => { sound.play("click"); onBack(); }} aria-label={t("common.back")}>
          <ArrowLeft size={16} />
        </button>
        <div>
          <span className="eyebrow">{t("browse.eyebrow")}</span>
          <h1>{t("browse.title")}</h1>
        </div>
      </div>

      <div className="browse-toolbar">
        <form className="browse-search" onSubmit={submitSearch}>
          <Search size={14} />
          <input
            value={pendingSearch}
            onChange={(event) => setPendingSearch(event.target.value)}
            placeholder={t("browse.searchPlaceholder")}
            aria-label={t("browse.searchPlaceholder")}
          />
          {pendingSearch && (
            <button type="button" className="search-clear" onClick={() => { setPendingSearch(""); setPage(1); setSearch(""); }} aria-label={t("common.close")}>
              ×
            </button>
          )}
        </form>

        <div className="browse-sorts" role="group" aria-label={t("browse.sortLabel")}>
          {ORDERINGS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sort-chip${ordering === item.id ? " is-active" : ""}`}
              onClick={() => { sound.play("click"); setPage(1); setOrdering(item.id); }}
            >
              {t(item.key)}
            </button>
          ))}
        </div>
      </div>

      <div className="browse-status">
        {loading ? (
          <span className="status-line status-line--busy"><LoaderCircle size={13} className="spin" /> {t("common.loading")}</span>
        ) : error ? (
          <span className="status-line status-line--warn">
            {offline ? <WifiOff size={13} /> : <CloudOff size={13} />} {error}
          </span>
        ) : (
          <span className="status-line">
            <Swords size={13} />
            {t("browse.resultCount", { count: count.toLocaleString() })}
          </span>
        )}
        {!loading && !error && (
          <span className="status-page">{t("browse.pageOf", { page, total: totalPages.toLocaleString() })}</span>
        )}
      </div>

      {loading && (
        <div className="deck-grid">
          {Array.from({ length: PAGE_SIZE }).map((_, index) => (
            <div className="deck-skeleton" key={index}>
              <span className="skeleton-art" />
              <span className="skeleton-lines"><i /><i /><i /></span>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="browse-empty">
          <span className="browse-empty-icon"><CloudOff size={22} /></span>
          <strong>{t("browse.offlineTitle")}</strong>
          <p>{t("browse.offlineBody")}</p>
          <button type="button" className="ghost-button" onClick={() => { sound.play("click"); onBack(); }}>
            <ArrowLeft size={15} /> {t("browse.useSaved")}
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="deck-grid deck-grid--browse">
            {decks.map((deck) => (
              <DeckTile
                key={deck.id}
                deck={deck}
                t={t}
                tag={deck.powerLevel ? `${t("deck.power")} ${deck.powerLevel}` : t("deck.masterVault")}
                onInspect={() => onInspect(deck)}
                onSelect={() => onUseDeck(deck)}
              />
            ))}
          </div>
          <div className="browse-pager">
            <Pagination page={page} totalPages={totalPages} onChange={(next) => { sound.play("click"); setPage(next); window.scrollTo({ top: 0, behavior: "smooth" }); }} label={t("browse.pagerLabel")} />
            <span className="pager-hint">{t("browse.pagerHint")}</span>
          </div>
        </>
      )}

      <div className="browse-houses" aria-hidden="true">
        {["Brobnar", "Dis", "Logos", "Sanctum", "Shadows", "Untamed", "Mars"].map((house) => (
          <HouseMark key={house} house={house} small />
        ))}
      </div>
    </div>
  );
}
