# Design QA

## Status

Blocked — the Release build is installed and running on the physical iPhone 17, but the device remained in the horizontal StandBy clock state during capture. The implemented deck-detail screen could not be visually compared on the physical display yet.

## Target

- Device: 陳德生のiPhone, iPhone 17 (iPhone18,3)
- OS: iOS 27.0
- Viewport capture: 1206 × 2622 px
- Screen: `専門・稀少` deck detail (`/deck/deck-freq4`)
- Expected order: summary card → study button → search bar → all cards in the deck

## Source of truth

- Reference screenshot: `/var/folders/r1/x4hpj5810bx3rck_gdvwq5q00000gn/T/codex-clipboard-4aaeabbd-2125-4ba5-af59-29df32a6f5dc.png`
- User-provided written layout order above takes precedence over the old screen shown in the reference.

## Implementation evidence

- Screen implementation: `src/app/deck/[id].tsx`
- Deck-scoped search and count queries: `src/api/contentApi.ts`
- Release build: succeeded with 0 errors and 2 warnings
- Physical installation: `dev.koukeneko.nekogo` version 1.0.0 (1)
- Physical launch: process started successfully; latest verified executable path was inside the newly installed Kioku app bundle
- Captures attempted: `/tmp/kioku-physical-deck-detail.png`, `/tmp/kioku-physical-deck-detail-2.png`, `/tmp/kioku-physical-root.png`

## Findings

- P0: none observed in build/install/launch verification.
- P1: visual acceptance is blocked because the physical display did not leave StandBy while captures were taken.
- P2: not assessable until the deck-detail view is visible on the physical device.

## Follow-up required for pass

1. Wake and unlock the physical iPhone 17, leaving Kioku in the foreground.
2. Open `nekogo://deck/deck-freq4`.
3. Capture the physical screen at 1206 × 2622 px.
4. Compare the reference and implementation together, including spacing, typography, radii, borders, clipping, and the first visible vocabulary rows.
5. Exercise the search field and a vocabulary-row navigation before changing this document to `Passed`.
