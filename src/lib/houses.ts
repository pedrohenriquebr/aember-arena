// Official house emblems served by the KeyForge Master Vault CDN, with an
// offline-safe glyph fallback so badges never render empty.
const CDN = "https://mastervault-storage-prod.s3.amazonaws.com/media/houses";

export interface HouseInfo {
  id: string;
  namePt: string;
  color: string;
  icon: string;
  /** Simple silhouette used when the official art cannot be loaded. */
  glyph?: string;
  short: string;
  /** BUG2-14: emblema desproporcional ao uso (Star Alliance/Saurian têm
      2,3 MB); offline o HouseIcon renderiza o fallback sem tocar na rede. */
  heavy?: boolean;
}

export const HOUSES: Record<string, HouseInfo> = {
  Brobnar: {
    id: "Brobnar",
    namePt: "Brobnar",
    color: "#c65e4a",
    icon: `${CDN}/Brobnar_RTivg44.png`,
    short: "BR",
    // Warhammer
    glyph:
      "M11.2 3.4 8.4 6.2l1.3 1.3-4.9 4.9a1.9 1.9 0 0 0 0 2.7l1.9 1.9a1.9 1.9 0 0 0 2.7 0l4.9-4.9 1.3 1.3 2.8-2.8-7.2-7.2ZM9.6 15.5l-1.1-1.1 4.6-4.6 1.1 1.1-4.6 4.6Z M17.4 14.6l2.6 2.6-2.4 2.4-2.6-2.6 2.4-2.4Z",
  },
  Dis: {
    id: "Dis",
    namePt: "Dis",
    color: "#9a76c7",
    icon: `${CDN}/Dis_OooSNPO.png`,
    short: "DS",
    // Horned skull
    glyph:
      "M5 3.2c1.6.5 2.6 1.9 3 3.6a7.4 7.4 0 0 1 8 0c.4-1.7 1.4-3.1 3-3.6-.6 1.7-.6 3.3-.2 4.8A7 7 0 0 1 20 12c0 2.6-1.6 4.8-4 5.9V21h-2v-2.3h-1.2V21h-1.6v-2.3H10V21H8v-3.1C5.6 16.8 4 14.6 4 12a7 7 0 0 1 1.2-3.9c.4-1.6.4-3.2-.2-4.9Zm4 8.1a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm6 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z",
  },
  Logos: {
    id: "Logos",
    namePt: "Logos",
    color: "#57a8c6",
    icon: `${CDN}/Logos_2mOY1dH.png`,
    short: "LG",
    // Atom
    glyph:
      "M12 9.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Zm0-7.2c1.7 0 3 2 3.6 5 3 .6 5 1.9 5 3.6 0 1.7-2 3-5 3.6-.6 3-1.9 5-3.6 5s-3-2-3.6-5c-3-.6-5-1.9-5-3.6 0-1.7 2-3 5-3.6.6-3 1.9-5 3.6-5Zm0 1.9c-.7 0-1.4 1.1-1.8 3a16 16 0 0 1 3.6 0c-.4-1.9-1.1-3-1.8-3ZM6.9 10.2c-1.9.4-3 1.1-3 1.8s1.1 1.4 3 1.8a16 16 0 0 1 0-3.6Zm10.2 0a16 16 0 0 1 0 3.6c1.9-.4 3-1.1 3-1.8s-1.1-1.4-3-1.8Zm-6.9 6.6c.4 1.9 1.1 3 1.8 3s1.4-1.1 1.8-3a16 16 0 0 1-3.6 0Z",
  },
  Mars: {
    id: "Mars",
    namePt: "Marte",
    color: "#bf70af",
    icon: `${CDN}/Mars_CmAUCXI.png`,
    short: "MR",
    // Martian head
    glyph:
      "M12 2.6c3.9 0 7 3 7 6.8 0 2-.9 3.8-2.3 5 .8.6 1.3 1.5 1.3 2.6v1.4c0 1.7-1.4 3-3 3H9c-1.6 0-3-1.3-3-3V17c0-1.1.5-2 1.3-2.6A6.7 6.7 0 0 1 5 9.4c0-3.8 3.1-6.8 7-6.8Zm0 2a4.8 4.8 0 0 0-5 4.8c0 2.6 2.2 4.8 5 4.8s5-2.2 5-4.8a4.8 4.8 0 0 0-5-4.8Zm-2.4 4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Zm4.8 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z",
  },
  Sanctum: {
    id: "Sanctum",
    namePt: "Santuário",
    color: "#d0ad5d",
    icon: `${CDN}/Sanctum_lUWPG7x.png`,
    short: "SA",
    // Shield with cross
    glyph:
      "M12 2.4 4.5 5.2v6.2c0 4.6 3.1 8.6 7.5 10.2 4.4-1.6 7.5-5.6 7.5-10.2V5.2L12 2.4Zm0 2.2 5.5 2v4.8c0 3.5-2.2 6.6-5.5 8-3.3-1.4-5.5-4.5-5.5-8V6.6l5.5-2Zm-1.1 2.6v2.6H8.3v2.2h2.6v4.4h2.2v-4.4h2.6V9.8h-2.6V7.2h-2.2Z",
  },
  Shadows: {
    id: "Shadows",
    namePt: "Sombras",
    color: "#8c9a90",
    icon: `${CDN}/Shadows_z0n69GG.png`,
    short: "SH",
    // Hooded figure
    glyph:
      "M12 2.4c3.6 0 6.5 3.1 6.5 7 0 1.4-.3 2.5-.8 3.7l2 7.9c-2.3 1-5 1.6-7.7 1.6s-5.4-.6-7.7-1.6l2-7.9a9.4 9.4 0 0 1-.8-3.7c0-3.9 2.9-7 6.5-7Zm0 2.1c-2.4 0-4.4 2.2-4.4 4.9 0 1 .2 1.8.6 2.7l.3.7-1.6 6.3c1.6.5 3.4.8 5.1.8s3.5-.3 5.1-.8l-1.6-6.3.3-.7c.4-.9.6-1.7.6-2.7 0-2.7-2-4.9-4.4-4.9Zm-2.2 4.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Zm4.4 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z",
  },
  Untamed: {
    id: "Untamed",
    namePt: "Indomáveis",
    color: "#78a66c",
    icon: `${CDN}/Untamed_bXh9SJD.png`,
    short: "UN",
    // Leaf and vine
    glyph:
      "M19.6 3.6c-7 0-12.3 2.6-12.3 8.5 0 1.9.6 3.4 1.5 4.6C10 15 11.7 13.3 14 12c-1.9 1.6-3.3 3.5-4.2 5.6-.5 1.2-.9 2.5-1.1 3.8H10c.2-1 .4-2 .8-2.9 6-.2 10.2-3.4 10.2-9.3 0-1.6-.5-3.2-1.4-5.6ZM18 6.2c.2.9.3 1.7.3 2.4 0 4.3-2.8 6.7-7.1 7.2 1.8-3 4.5-5.3 7.8-6.6-3.2.6-6 2-8.2 4 .6-3.8 4.2-6 8.5-6.6l-1.3-.4Z",
  },
  // Expansion houses and special factions (Adventures): no hand-drawn glyph,
  // the initials fallback covers offline rendering.
  "Star Alliance": {
    id: "Star Alliance",
    namePt: "Aliança Estelar",
    color: "#4a86c8",
    icon: `${CDN}/Star_Alliance.png`,
    short: "ST",
    // BUG2-14: 2,35 MB no S3 (curl; sem variante menor — 200/64/_small dão 403).
    heavy: true,
  },
  Saurian: {
    id: "Saurian",
    namePt: "Sáurios",
    color: "#8aa04c",
    icon: `${CDN}/Saurian.png`,
    short: "SA",
    // BUG2-14: 2,36 MB no S3, também sem variante menor.
    heavy: true,
  },
  Unfathomable: {
    id: "Unfathomable",
    namePt: "Insondáveis",
    color: "#4fa8b8",
    icon: `${CDN}/Unfathomable.png`,
    short: "UN",
  },
  Ekwidon: {
    id: "Ekwidon",
    namePt: "Ekwidon",
    color: "#c88a4a",
    icon: `${CDN}/Ekwidon200.png`,
    short: "EK",
  },
  Geistoid: {
    id: "Geistoid",
    namePt: "Geistóide",
    color: "#9aa0ae",
    icon: `${CDN}/KF_Geistoid.png`,
    short: "GE",
  },
  Skyborn: {
    id: "Skyborn",
    namePt: "Celestes",
    color: "#a88fd0",
    icon: `${CDN}/Skyborn.png`,
    short: "SK",
  },
  Redemption: {
    id: "Redemption",
    namePt: "Redenção",
    color: "#c8a04a",
    icon: `${CDN}/Redemption.png`,
    // BUG2-15: "RE" colidia com Rebels no fallback por iniciais.
    short: "RD",
  },
  Keyraken: {
    id: "Keyraken",
    namePt: "Keyraken",
    color: "#5e8a96",
    icon: `${CDN}/KF_Keyraken.png`,
    short: "KE",
  },
  Ouboros: {
    id: "Ouboros",
    namePt: "Ouboros",
    color: "#7f7392",
    icon: `${CDN}/ouboros.png`,
    short: "OU",
  },
  Rebels: {
    id: "Rebels",
    namePt: "Rebels",
    color: "#a3796a",
    icon: `${CDN}/Rebels.png`,
    // BUG2-15: era "RE", igual a Redemption.
    short: "RB",
  },
  Elders: {
    id: "Elders",
    namePt: "Elders",
    color: "#8f8b7a",
    icon: `${CDN}/Elders.png`,
    short: "EL",
  },
};

export function houseInfo(house: string): HouseInfo {
  return (
    HOUSES[house] ?? {
      id: house,
      namePt: house,
      color: "#b98948",
      icon: "",
      short: house.slice(0, 2).toUpperCase(),
    }
  );
}

export function houseColor(house: string): string {
  return houseInfo(house).color;
}

/**
 * Returns the localized display name of a house (e.g., "Mars" -> "Marte" in PT-BR).
 * Accepts an optional translator `t`; when omitted, reads the active document language.
 */
export function houseLabel(house: string, t?: (key: string) => string): string {
  if (!house) return "";
  if (t) {
    const key = `house.${house}`;
    const value = t(key);
    if (value !== key) return value;
  }
  const isPt =
    typeof document !== "undefined" &&
    document.documentElement.lang.toLowerCase().startsWith("pt");
  return isPt ? houseInfo(house).namePt : house;
}
