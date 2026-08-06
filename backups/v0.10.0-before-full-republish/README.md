# TSB Hub backup before full republish

Created: 2026-08-07

This backup point records the exact Git blobs used before the full v0.10.1 republish.
Git history contains the complete byte-for-byte contents and can restore every file.

## Files

- `index.html` — blob `f2eb89a5748e0cc25cf0d207a81440ff89b42127`
- `js/app.js` — blob `b960a5be87c966752502a3e0e72c25932e68908a`
- `js/mobile-first-cleanup.js` — latest package v0.9.9 before republish
- `js/finance-module-v1.js` — latest package v0.9.9 before republish
- `css/mobile-first-cleanup.css` — latest package v0.9.9 before republish
- `service-worker.js` — blob `940155c80c23bc21589f42e71d5139d72140d79e`

## Restore principle

Restore any file from the recorded blob or revert the commits after this backup directory was created.
The persistent localStorage key remains `tsb_hub_data_v1`; code rollback does not delete user data.
