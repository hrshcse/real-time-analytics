# Accessibility (WBS 19)

## Automated checks

`e2e/accessibility.spec.ts` runs **axe-core** (WCAG 2.0/2.1 A + AA rules) against the live
dashboard twice: default view, and with the Performance panel, Pipeline details and replay controls
open. Both report **0 violations**. The first run found one: KPI hints were `<p>` elements inside
`<dl>` groups (invalid definition-list structure); they're now a second `<dd>` for the same `<dt>`.

## What's built in

| WBS item                       | How                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard navigation            | All controls are native buttons/selects/inputs. The grid is one tab stop with `aria-activedescendant`: ↑/↓, PgUp/PgDn, Home/End move, Space selects                                   |
| Accessible buttons and labels  | Every select/input has a `<label for>` or `aria-label`; segmented range control is a `radiogroup`; toggles use `aria-pressed` / `aria-expanded`                                       |
| Connection status announcement | Header badge is `role="status"` + `aria-live="polite"`: announced on change only                                                                                                      |
| `aria-live` used carefully     | Streamed numbers (KPIs, stats, chart values) are **not** live regions; they would announce several times a second. The E2E suite asserts KPI cards contain no `aria-live`             |
| Error announcements            | Errors use `role="alert"`; reconnecting/empty/partial states use `role="status"`                                                                                                      |
| Reduced motion                 | `prefers-reduced-motion: reduce` disables the status pulse (E2E-checked); charts never animate (`animation: false`)                                                                   |
| Accessible data table          | `role="grid"` with `aria-rowcount` = total rows (100,001 incl. header), `aria-rowindex` on each rendered row, `aria-sort` on headers, `aria-selected` on rows, `aria-multiselectable` |
| Not colour alone               | Status = dot + text ("Connected", "Reconnecting… 2/10"); banners have an icon + text; p95 is dashed as well as orange; warnings keep their label                                      |
| Charts                         | Each canvas is `role="img"` with a label including the latest value; the Pipeline details table is the text alternative                                                               |

## Known gaps

- Chart tooltips are mouse/touch only; keyboard users read values from the Pipeline details table.
- Column resizing is pointer-only (the handle is a `separator` with a label, but no keyboard step).
- A screen-reader pass with NVDA/VoiceOver hasn't been done; axe catches structure, not experience.
