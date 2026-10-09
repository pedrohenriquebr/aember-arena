// Fixtures dos gates da v2 (UX_REWRITE_PLAN §5 H-22). Nada de hook no app: a partida salva de
// verdade (localStorage "aember-arena-match", regravada a cada jogada) é fechada com o vencedor
// pedido, e a tela de resultado é lida como o usuário a vê. O motor não é tocado.

export const MATCH_KEY = "aember-arena-match";
export const STAT_KEYS = ["amberGained", "amberStolen", "amberCaptured", "creaturesDestroyed", "cardsPlayed", "keys"];

const WIN = { amberGained: 12, amberStolen: 2, amberCaptured: 1, creaturesDestroyed: 4, cardsPlayed: 14, keys: 3 };
const LOSS = { amberGained: 5, amberStolen: 0, amberCaptured: 0, creaturesDestroyed: 1, cardsPlayed: 9, keys: 1 };

/** Valores esperados por lado (0 = jogador, 1 = Warden) para o vencedor dado. */
export function expectedSides(winner) {
  return winner === 0 ? [WIN, LOSS] : [LOSS, WIN];
}

/** Fecha a partida salva: winner, contadores por lado e o log de chaves (3 do vencedor, 1 do outro). */
export async function closeSavedMatch(page, winner) {
  await page.evaluate(({ key, winner, sides }) => {
    const saved = JSON.parse(localStorage.getItem(key));
    const game = saved.game;
    game.winner = winner;
    game.turn = 6;
    sides.forEach((stats, side) => Object.assign(game.players[side], stats));
    const marks = [{ side: winner, turn: 2 }, { side: 1 - winner, turn: 3 }, { side: winner, turn: 4 }, { side: winner, turn: 6 }];
    game.log = [...game.log, ...marks.map(({ side, turn }) => ({ key: "log.forge", params: { name: game.players[side].name }, turn }))];
    localStorage.setItem(key, JSON.stringify(saved));
  }, { key: MATCH_KEY, winner, sides: expectedSides(winner) });
}

/** Lê a S9 como o usuário a vê: stats por lado, marcas da timeline e os botões primários. */
export async function readResult(page) {
  return page.evaluate((keys) => {
    const root = document.querySelector('[data-screen="result"]');
    if (!root) return null;
    const stats = {};
    for (const key of keys) {
      const row = root.querySelector(`[data-stat="${key}"]`);
      stats[key] = [0, 1].map((side) => Number(row?.querySelector(`td[data-side="${side}"]`)?.textContent));
    }
    return {
      stats,
      marks: root.querySelectorAll(".nf-result-mark").length,
      primaries: root.querySelectorAll(".nf-btn--primary").length,
      primaryText: root.querySelector(".nf-btn--primary")?.textContent?.trim() ?? null,
      recordShown: root.querySelector(".nf-result-record") !== null,
    };
  }, STAT_KEYS);
}

/** Problemas da leitura frente ao vencedor esperado (lista vazia = passou). */
export function resultProblems(read, winner, { solo = true } = {}) {
  if (!read) return ["sem [data-screen=\"result\"] na tela"];
  const problems = [];
  const expected = expectedSides(winner);
  for (const key of STAT_KEYS) {
    for (const side of [0, 1]) {
      if (read.stats[key]?.[side] !== expected[side][key]) {
        problems.push(`stat ${key} lado ${side}: ${read.stats[key]?.[side]} (esperado ${expected[side][key]})`);
      }
    }
  }
  if (read.marks < 1) problems.push("timeline sem nenhuma marca");
  if (read.primaries !== 1) problems.push(`${read.primaries} botões primary (esperado 1)`);
  if (read.primaryText !== "Rematch") problems.push(`primary "${read.primaryText}" (esperado Revanche/Rematch)`);
  if (solo && !read.recordShown) problems.push("partida solo sem o cartão de recorde");
  if (!solo && read.recordShown) problems.push("pass-and-play com recorde (2P não tem)");
  return problems;
}
