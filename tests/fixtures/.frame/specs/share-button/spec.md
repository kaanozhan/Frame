# Add Share button to ProductPage

## Problem

Customers viewing a product page have no quick way to share the product on social media. The current flow requires copying the URL and pasting it manually into Twitter/X. This adds friction for users who want to surface products to their network and reduces the chance of organic referral traffic.

## Goal

Add a Share button to `ProductPage.tsx` that opens a Twitter intent URL prefilled with the product title and the product's canonical URL.

## Constraints

- No external analytics SDK — use the existing `trackEvent` helper
- Must respect the user's accessibility settings (visible focus ring, ARIA label)
- Don't bundle the Twitter SDK — use the plain intent URL pattern
- Mobile layout: button collapses to icon-only below 480px viewport

## Success Criteria

- Clicking the button opens `https://twitter.com/intent/tweet?text=<title>&url=<canonical>` in a new tab
- Button is keyboard-accessible and screen-reader friendly
- `share_clicked` analytics event fires with `{ productId, surface: 'product_page' }`
- Visual regression test passes for desktop + mobile breakpoints

## Out of Scope

- LinkedIn / Facebook / WhatsApp share buttons (separate spec)
- Custom Open Graph image generation (already handled server-side)
- A/B testing the button placement
