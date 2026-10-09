import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DeckInfo } from "../lib/game";
import { fetchDeckPage, VaultError } from "../lib/keyforgeApi";
import { sound } from "../lib/sound";

/** Tamanho da página do Vault (a v1 e a biblioteca da v2 usam o mesmo: 9 tiles). */
export const VAULT_PAGE_SIZE = 9;

export const VAULT_ORDERINGS: { id: string; key: string }[] = [
  { id: "-date", key: "browse.sortNewest" },
  { id: "date", key: "browse.sortOldest" },
  { id: "name", key: "browse.sortName" },
  { id: "-power_level", key: "browse.sortPower" },
];

export interface BrowseState {
  page: number;
  search: string;
  ordering: string;
}

export const INITIAL_BROWSE: BrowseState = { page: 1, search: "", ordering: "-date" };

/**
 * Estado e busca do Vault (UX_REWRITE_PLAN §5 H-15, extraído de DeckBrowser). A página, a busca
 * e a ordem vêm de `state` quando o pai as controla (BUG-15: ida e volta ao Detalhe preserva a
 * página); sem `state` o hook guarda o próprio. `enabled=false` não chama a API (offline na v2).
 */
export function useVaultBrowse({ state, onStateChange, enabled = true }: {
  state?: BrowseState;
  onStateChange?: (next: BrowseState) => void;
  enabled?: boolean;
}) {
  const [internalState, setInternalState] = useState<BrowseState>(INITIAL_BROWSE);
  const view = state ?? internalState;
  const { page, search, ordering } = view;
  const setView = (patch: Partial<BrowseState>) => {
    const next = { ...view, ...patch };
    if (onStateChange) onStateChange(next);
    else setInternalState(next);
  };
  const [pendingSearch, setPendingSearch] = useState(search);
  const [decks, setDecks] = useState<DeckInfo[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);

    fetchDeckPage({ page, pageSize: VAULT_PAGE_SIZE, search, ordering })
      .then((result) => {
        if (requestId !== requestRef.current) return;
        setDecks(result.decks);
        setCount(result.count);
      })
      .catch((cause: unknown) => {
        if (requestId !== requestRef.current) return;
        setDecks([]);
        setCount(0);
        setError(cause ?? new VaultError("browse.failed"));
        if (!(cause instanceof VaultError && cause.key === "vault.noResults")) sound.play("error");
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });

    return () => {
      requestRef.current += 1;
    };
  }, [page, search, ordering, enabled]);

  // An empty result for a search is not a failure: it gets its own state
  // instead of the "Vault is out of reach" screen.
  const noResults = error instanceof VaultError && error.key === "vault.noResults";
  const totalPages = Math.max(1, Math.min(Math.ceil(count / VAULT_PAGE_SIZE), 5000));

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sound.play("click");
    setView({ page: 1, search: pendingSearch.trim() });
  };

  const clearSearch = () => {
    setPendingSearch("");
    setView({ page: 1, search: "" });
  };

  return {
    view,
    pendingSearch,
    setPendingSearch,
    decks,
    count,
    loading,
    error,
    noResults,
    totalPages,
    setView,
    submitSearch,
    clearSearch,
  };
}
