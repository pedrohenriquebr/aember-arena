import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setupTest } from "../../../lib/testkit";
import type { GameState } from "../../../lib/game";
import { createTranslator } from "../../../lib/i18n";
import type { DeckStats } from "../../../lib/cache";
import { ResultScreen, type ResultScreenProps } from "./ResultScreen";

// UX_REWRITE_PLAN §5 H-22: contrato estático da S9 (o browser cobre o clímax e o journey).
// renderToStaticMarkup não roda efeitos: com animate=false o markup já traz os valores finais.
const t = createTranslator("en");
const ptBR = createTranslator("ptBR");

function finished(winner: 0 | 1): GameState {
  const state = setupTest({}, {});
  state.winner = winner;
  state.turn = 8;
  state.players[0] = { ...state.players[0], amberGained: 12, amberStolen: 2, amberCaptured: 1, creaturesDestroyed: 4, cardsPlayed: 14, keys: 3 };
  state.players[1] = { ...state.players[1], amberGained: 5, amberStolen: 0, amberCaptured: 0, creaturesDestroyed: 1, cardsPlayed: 9, keys: 1 };
  state.log = [
    { key: "log.forge", params: { name: "You" }, turn: 3 },
    { key: "log.forge", params: { name: "The Ember Warden" }, turn: 5 },
    { key: "log.forge", params: { name: "You" }, turn: 7 },
    { key: "log.forge", params: { name: "You" }, turn: 8 },
  ];
  return state;
}

function render(overrides: Partial<ResultScreenProps> = {}, translate = t) {
  const props: ResultScreenProps = {
    t: translate,
    game: finished(0),
    sideNames: ["You", "The Ember Warden"],
    passAndPlay: false,
    animate: false,
    record: { deckId: "d", wins: 4, losses: 2, byDifficulty: {}, lastOpponentMode: "mirror", updatedAt: 0 } satisfies DeckStats,
    canReplay: true,
    onRematch: () => {},
    onChooseDeck: () => {},
    onReplay: () => {},
    onLobby: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(<ResultScreen {...props} />);
}

const stat = (html: string, key: string, side: 0 | 1) => new RegExp(`data-stat="${key}"[\\s\\S]*?data-side="${side}">([0-9]+)<`).exec(html)?.[1];

describe("ResultScreen (S9)", () => {
  it("não renderiza enquanto a partida não acabou", () => {
    const live = setupTest({}, {});
    expect(render({ game: live })).toBe("");
  });

  it("vitória do jogador: os seis stats dos dois lados com os valores finais", () => {
    const html = render();
    expect(stat(html, "amberGained", 0)).toBe("12");
    expect(stat(html, "amberStolen", 0)).toBe("2");
    expect(stat(html, "amberCaptured", 0)).toBe("1");
    expect(stat(html, "creaturesDestroyed", 0)).toBe("4");
    expect(stat(html, "cardsPlayed", 0)).toBe("14");
    expect(stat(html, "keys", 0)).toBe("3");
    expect(stat(html, "amberGained", 1)).toBe("5");
    expect(stat(html, "keys", 1)).toBe("1");
    expect(html).toContain("You forged the third key.");
  });

  it("vitória do Warden: o banner e o lado vencedor mudam, os stats seguem nos lados certos", () => {
    const html = render({ game: finished(1) });
    expect(html).toContain("The Ember Warden forged the third key.");
    expect(html).toContain("nf-result--lost");
    expect(stat(html, "keys", 0)).toBe("3");
  });

  it("exatamente um botão primary (Revanche), e é o primeiro foco", () => {
    const html = render();
    expect(html.match(/nf-btn--primary/g)).toHaveLength(1);
    expect(html.indexOf("nf-btn--primary")).toBeLessThan(html.indexOf("Change deck"));
    expect(html).toContain("Rematch");
  });

  it("timeline: uma marca por chave, com a rodada e o lado", () => {
    const html = render();
    expect(html.match(/class="nf-result-mark"/g)).toHaveLength(4);
    expect(html).toContain("Round 3 · You");
    expect(html).toContain("Round 5 · The Ember Warden");
  });

  it("timeline parcial (log cortado) avisa; a contagem continua a dos stats", () => {
    const game = finished(0);
    game.log = [{ key: "log.forge", params: { name: "You" }, turn: 7 }];
    const html = render({ game });
    expect(html).toContain(t("ui.result.timelinePartial"));
    expect(stat(html, "keys", 0)).toBe("3");
  });

  it("sem chaves forjadas: texto de timeline vazia, sem marcas", () => {
    const game = finished(1);
    game.log = [];
    const html = render({ game });
    expect(html).toContain(t("ui.result.timelineEmpty"));
    expect(html).not.toContain('class="nf-result-mark"');
  });

  it("recorde do deck aparece com o delta da partida (solo)", () => {
    expect(render()).toContain("+1 win");
    expect(render({}, ptBR)).toContain("+1 vitória");
    expect(render({ game: finished(1) })).toContain("+1 loss");
  });

  it("pass-and-play: sem recorde e com o nome do lado vencedor", () => {
    const html = render({ passAndPlay: true, sideNames: ["Player 1", "Player 2"], game: finished(1) });
    expect(html).not.toContain("nf-result-record");
    expect(html).not.toContain("+1 loss");
    expect(html).toContain("Player 2 forged the third key.");
  });

  it("sem recorde (storage falhou): o cartão some e o resto fica", () => {
    const html = render({ record: null });
    expect(html).not.toContain("nf-result-record");
    expect(stat(html, "keys", 0)).toBe("3");
  });

  it("replay só aparece quando a partida pode ser revista", () => {
    expect(render({ canReplay: false })).not.toContain("Replay");
    expect(render({ canReplay: true })).toContain("Replay");
  });
});
