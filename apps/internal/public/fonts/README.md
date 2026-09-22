# Cairo for the internal application

These Google Fonts Cairo WOFF2 subsets are the same font assets already resolved
by the storefront's `next/font/google` build (Arabic, Latin extended, and Latin).
The accompanying CSS preserves that build's Unicode coverage and weights
400, 500, 600, 700, and 800. Cairo is licensed under the included SIL OFL.

They are checked in so internal screens do not depend on Google Fonts at runtime.
The existing Vite PWA `woff2` precache glob includes them automatically. Keep the
font CSS and these assets together when updating Cairo; no runtime font cache or
new font dependency is required.
