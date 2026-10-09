import { cx } from "./cx";

/**
 * Placeholder de carregamento. Decorativo (aria-hidden): quem carrega diz o estado em texto.
 * width/height são comprimentos CSS (ex.: "100%", "1em"), não números de px.
 */
export function Skeleton({ width = "100%", height = "1em", shape = "line" }: {
  width?: string;
  height?: string;
  shape?: "line" | "block" | "circle";
}) {
  return <span aria-hidden="true" className={cx("nf-skeleton", `nf-skeleton--${shape}`)} style={{ width, height }} />;
}
