/**
 * The poster grid's column classes. Phones keep 6.5rem tiles. From the sm breakpoint a tile is at least 8rem or 7% of
 * the window width, whichever is wider, so wide windows get bigger posters (about 12 across at 3440px) instead of ever
 * more columns. Home, the Focus pages and the loading skeleton share it, so tiles don't change size when the skeleton
 * is replaced.
 */
export const POSTER_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(max(8rem,7vw),1fr))]";

/**
 * A tile's height estimate while content-visibility skips it off screen. It follows the 7vw minimum above: the poster is
 * 2:3, so about 10.5vw tall, plus about 4rem of text below it. Change the two together, or the scrollbar jumps as tiles
 * render.
 */
export const POSTER_TILE_CLASS = "[contain-intrinsic-size:auto_max(15rem,calc(10.5vw+4rem))] [content-visibility:auto]";
