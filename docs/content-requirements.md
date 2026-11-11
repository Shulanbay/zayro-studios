# Content requirements (owner input needed)

The site only shows confirmed facts. These items are missing and are
deliberately **not** faked; each section appears automatically once real
content exists.

## Hero media (optional)
`HeroSection` accepts a `media` slot. Needed: a short silent loop (≤ 8 s,
≤ 2 MB, 16:9 and 9:16 crops) or a still photo of the Midtown studio, shot in
the real space, with release rights. No stock footage or generated imagery.

## Portfolio — `src/lib/showcase.ts → PROJECTS`
- Work recorded at the Midtown studio: `location: 'zayro-midtown'`.
- Earlier work by the team elsewhere: `location: 'prior'`, shown under
  **SELECTED PRODUCTION WORK** with the disclosure "Produced by the ZAYRO team
  before the opening of our Midtown studio." Never label it "Recorded at ZAYRO".
- Per project: title, client (with permission), 1–2 sentence summary, image
  (1600×900 webp) and optional link. Set `published: true` to show it.

## Testimonials — `src/lib/showcase.ts → TESTIMONIALS`
Real client quotes with written permission (`permissionOnFile: true`). No
star ratings and no Review / AggregateRating schema until real reviews are
visible on the page.

## Facts to confirm
Resolved 2026-11-11: edited episodes are delivered within 3 business days;
"Open 7 Days" stays database-driven; at most 3 cameras per session
(Single Podcaster +2 Additional Camera, Podcast Pro / Full Podcast Package
none), enforced on the server via `services.metadata.includedCameras`.
