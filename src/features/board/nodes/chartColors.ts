/**
 * Categorical series colours, assigned by position (series 1 is always slot 1).
 * The six hues are CSS variables (`--chart-1..6` in nodes.css, themed light and
 * dark and checked with the dataviz validator), so the chart follows the theme
 * with no JS. Beyond six series the palette cycles: the legend and tooltip carry
 * identity then, not colour alone.
 */
export const CHART_SLOTS = 6;
export const chartColor = (index: number): string => `var(--chart-${(((index % CHART_SLOTS) + CHART_SLOTS) % CHART_SLOTS) + 1})`;
