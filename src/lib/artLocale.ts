// Arte "quando houver" em PT-BR: o S3 do Master Vault guarda o render impresso por idioma
// (…/card_front/en/<id>_en.png ↔ …/card_front/pt/<id>_pt.png). Só algumas expansões têm o
// render PT; o resto responde 403, e quem decide o fallback é o CardImage (onError).

const MV_ART_HOST = "https://mastervault-storage-prod.s3.amazonaws.com/";
const EN_ART_PATH = /(^https:\/\/mastervault-storage-prod\.s3\.amazonaws\.com\/media\/card_front\/)en\/([^/?#]+)_en\.png(?=$|[?#])/;

/** Troca o render EN pelo PT. URL que não é o EN do S3 do MV volta intacta (idempotente). */
export function ptArtUrl(image: string): string {
  if (!image.startsWith(MV_ART_HOST)) return image;
  return image.replace(EN_ART_PATH, (_, base: string, file: string) => `${base}pt/${file}_pt.png`);
}

/** Mesma chave que o `readSettings` lê; qualquer falha (sem storage, JSON ruim) vira "en". */
export function currentUiLanguage(): "en" | "ptBR" {
  try {
    const saved = localStorage.getItem("aember-arena-settings");
    if (!saved) return "en";
    return (JSON.parse(saved) as { language?: unknown }).language === "ptBR" ? "ptBR" : "en";
  } catch {
    return "en";
  }
}

/** Arte no idioma da UI: só reescreve quando o app está em português. */
export function localizedArtUrl(image: string): string {
  return currentUiLanguage() === "ptBR" ? ptArtUrl(image) : image;
}
