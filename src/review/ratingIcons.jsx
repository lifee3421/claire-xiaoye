// Plain SVG icons for FiveLevelSelector, using `fill="currentColor"` so the
// active/inactive color comes entirely from CSS (`.review-five-level__options
// button` / `.is-active`). A native color emoji (⚡, and to a lesser risk any
// star emoji variant) carries its own baked-in color layers that `color`/
// `fill` in CSS cannot override — that's why the energy selector used to look
// permanently yellow regardless of selection state. These SVGs have no
// emoji-presentation fallback, so they always follow currentColor.
export function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4.5 13h6L9.5 22 19.5 9h-6L13 2Z" fill="currentColor" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="m12 2.5 2.93 5.94 6.56.95-4.75 4.63 1.12 6.53L12 17.47l-5.86 3.08 1.12-6.53L2.51 9.39l6.56-.95L12 2.5Z"
      />
    </svg>
  );
}
