# Plan — Add Share button to ProductPage

## Architecture

Single new presentational component (`ShareButton`). Lives in the existing product-page module; no new state container needed. Tweet text is computed client-side from props, no server round-trip.

## Files

- **New** `src/components/ShareButton.tsx` — the button component
- **New** `src/components/ShareButton.module.css` — scoped styles
- **Modified** `src/pages/ProductPage.tsx` — import and place ShareButton next to existing CTA row
- **Modified** `src/lib/analytics.ts` — register the `share_clicked` event type (one-line addition)

## Dependencies

None added. Uses existing:
- `trackEvent` from `src/lib/analytics.ts`
- Tailwind utility classes already in use elsewhere on ProductPage
- Lucide `Share2` icon (already in `package.json`)

## Sequencing

1. Implement `ShareButton.tsx` with intent URL builder + analytics call
2. Wire into `ProductPage.tsx` next to the cart CTA
3. Add `share_clicked` event type
4. Visual regression snapshots (desktop + mobile)
