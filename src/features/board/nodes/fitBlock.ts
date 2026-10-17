/** Limits shared by the "Ajustar" button of the data blocks. */
export const FIT_MAX_WIDTH = 1400;
export const FIT_MAX_HEIGHT = 1600;

/**
 * Block size that shows `area`'s content without scrolling: the block's chrome (header, data
 * bar, padding) is what the block has beyond the scroll area. `natural` is the content size;
 * default is the area's own scroll size. Rounded and clamped to [min, max]; null when the
 * area is not inside a block. Pure measurement: the caller decides to write.
 */
export function fitBlockSize(
  area: HTMLElement | null,
  min: { width: number; height: number },
  natural?: { width: number; height: number },
): { width: number; height: number } | null {
  const block = area?.closest<HTMLElement>(".block");
  if (!area || !block) return null;
  const w = natural?.width ?? area.scrollWidth;
  const h = natural?.height ?? area.scrollHeight;
  const width = Math.round(block.offsetWidth - area.clientWidth + w);
  const height = Math.round(block.offsetHeight - area.clientHeight + h);
  return {
    width: Math.max(min.width, Math.min(FIT_MAX_WIDTH, width)),
    height: Math.max(min.height, Math.min(FIT_MAX_HEIGHT, height)),
  };
}

/**
 * Natural size of `content` (the one child that holds everything inside the scroll `area`), plus
 * the area's padding. The height is the content's own, so the block can shrink as well as grow.
 * The width never goes below the area's current width: it only grows when the content is wider.
 */
export function contentSize(area: HTMLElement, content: HTMLElement): { width: number; height: number } {
  const cs = getComputedStyle(area);
  const px = (v: string) => parseFloat(v) || 0;
  const padX = px(cs.paddingLeft) + px(cs.paddingRight);
  const padY = px(cs.paddingTop) + px(cs.paddingBottom);
  return {
    width: Math.max(area.clientWidth, content.scrollWidth + padX),
    height: content.offsetHeight + padY,
  };
}
