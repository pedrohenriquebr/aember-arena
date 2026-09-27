import { useEffect, useState, type CSSProperties } from "react";
import { houseInfo, houseLabel } from "../lib/houses";

type IconSize = "xs" | "sm" | "md" | "lg";

const PIXELS: Record<IconSize, number> = { xs: 20, sm: 23, md: 27, lg: 34 };

/**
 * Official Master Vault house emblem inside a tinted medallion.
 * Falls back to a silhouette glyph, then to initials, so it always reads.
 */
export function HouseIcon({
  house,
  size = "sm",
  plain = false,
  title,
}: {
  house: string;
  size?: IconSize;
  /** Render just the emblem, without the medallion ring. */
  plain?: boolean;
  title?: string;
}) {
  const info = houseInfo(house);
  const label = houseLabel(house);
  const [failed, setFailed] = useState(false);
  const pixels = PIXELS[size];

  useEffect(() => setFailed(false), [info.icon]);

  return (
    <span
      className={`house-icon house-icon--${size}${plain ? " house-icon--plain" : ""}`}
      style={{ "--house-color": info.color, width: pixels, height: pixels } as CSSProperties}
      title={title ?? label}
      role="img"
      aria-label={label}
    >
      {!failed && info.icon ? (
        <img src={info.icon} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : info.glyph ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={info.glyph} fill="currentColor" />
        </svg>
      ) : (
        <b>{info.short}</b>
      )}
    </span>
  );
}

export function HouseRow({ houses, size = "sm" }: { houses: string[]; size?: IconSize }) {
  return (
    <span className="deck-houses">
      {houses.map((house) => (
        <HouseIcon key={house} house={house} size={size} />
      ))}
    </span>
  );
}
