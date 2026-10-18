/**
 * Bring the next step of an order form into view.
 *
 * Called once per form, the first time the customer picks a package: on a phone
 * the package grid is tall enough that «۲. حساب …» sits below the fold, and a
 * customer who has just chosen is left looking at a screen that does not say
 * what happens next.
 *
 * Deliberately NOT called on every change. Someone comparing two packages taps
 * several in a row, and pulling the viewport away under each tap makes the
 * comparison impossible; the caller owns that "only the first time" rule.
 *
 * The landing position comes from the target's own `scroll-margin-top`, which
 * is why this uses `scrollIntoView` rather than computing an offset: the
 * previous step stays partly on screen, so going back to change the package is
 * one short scroll rather than a hunt.
 */
export function revealStep(element: HTMLElement | null): void {
  if (element === null) return;

  /* Already comfortably on screen: the two-column desktop layout puts the next
   * step beside the picker rather than below it, and scrolling to something the
   * customer is already looking at reads as the page jumping on its own.
   *
   * The line is the halfway mark rather than the fold. Clicking a package also
   * focuses its visually-hidden radio, and the browser scrolls that into view
   * on its own; a check against the fold would read that nudge as "the step is
   * visible now" and stop, leaving the step clinging to the bottom edge. */
  const { top } = element.getBoundingClientRect();
  if (top >= 0 && top < window.innerHeight * 0.5) return;

  /* `scroll-behavior:auto` in CSS does not cancel a smooth `scrollIntoView`,
   * so the reduced-motion preference has to be read here as well. */
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}
