# Build 202 — consistent panel commands

360 automated tests passed, 0 failed from the packaged source. The focused readiness/authentication selection passed 37 tests. Upgrade 201 → 202 and repeat 202 → 202 passed: all 59 update entries matched their hashes and six synthetic protected files under config, sessions, data, media and reports remained unchanged. Compatibility hashes were checked against shipped baselines 188–201.

New regressions cover repeated .panel/.panel-quick calls after readiness without changing server, tunnel, URL, menu or runtime generation; fresh ordered registration/failure logs including split chunks and separate stdout/stderr; temporary reconnect notes after verification; explicit panel-off/new start; and a genuine tunnel exit followed by recovery.

The controller receives a narrow connection-flow change. The mint UI, job runners, owner/token verification and mutation controls are retained. The display build number changes to 202.

Production evidence supplied by the user on 30 September 2026 shows Build 201's panel loaded data around 14:11 MYT, then controller HTTPS verification succeeded at 14:13 MYT. This is recovery evidence, not a 24-hour stability test. Build 202 has not yet been run on that phone. No change is made to cloudflared's default protocol; the update guide preserves the HTTP/2 launch command used during the phone test.

---

# Build 201 — tunnel recovery regression

Build 200 could stop a live tunnel when its readiness retry window expired. Build 201 preserves it and retries the same URL with a bounded background budget. DNS/HTTP/timeout causes are retained; .panel-quick reuses pending runtime. Test-open is labelled unverified and requires a registered quick tunnel; mismatched panel identity blocks it.

355 automated tests passed, 0 failed. Upgrade 200 → 201 and repeat 201 → 201 preserve protected files in isolated verification. Focused tests cover eventual recovery, no duplicate probes, old-runtime cancellation, bounded retries, error classification, allocated URL parsing, notification failure and real local HTTP challenge with API authentication still enforced. No live phone/Cloudflare connection is claimed as tested.

---

# Build 200 — audit fungsi Mini App

Result: passed for the tested local scope; live Termux/Telegram/WhatsApp and 24-hour operation remain device checks.

No visual redesign. Build 199 mint layout is retained. Browser uses shipped app assets and actual PanelServer, signed synthetic initData, native store functions and isolated SQLite. WhatsApp transport and controller runner-start callbacks are simulated; native Auto Join runner execution is also separately tested.

Verified by clicks: navigation, typed job selection, pause/resume/stop for post/join/gs, cancel confirmation, delete eligible Auto Join, block post deletion before report, preserve other jobs and client payment, group/account/client filters, pagination, first result details, report totals, copy bot command, and CSV download content.

Resolved: stale confirmations crossing navigation, old action response replacing another job, old polls overwriting mutation state, WAITING Auto Post control mismatch, premature ready message, cancelled/old tunnel publishing stale URL, fixed-URL startup blocking while probing, and SDK load ordering.

Automated suite: 346 tests passed, 0 failed. Tests include state races, identity, native controls and runner dispatch/pacing. Browser database evidence recorded in the audit fixture; no real user tokens, database or sessions included in release.

---

# Mini App design QA — Build 199

Result: passed

Scope: local browser prototype and existing controller integration tests. This is a mint adaptation of the user's TgLinks references, not a pixel-identical copy. Production Telegram/Termux validation of Build 199 remains on the user's device.

## Reference and visible comparison

- User reference: attachment 1904241.jpg (TgLinks progress/card/line styling); current WAPromoBot light/dark screenshots supplied in the conversation.
- Viewport: preview iframe 393 × 852; additional 320 × 852 check (305 CSS px content with desktop scrollbar).
- Full side-by-side: output/qa199-reference-full.jpg — opened and inspected.
- Progress crop side-by-side: output/qa199-progress-focus.jpg — opened and inspected.
- Render evidence: miniapp199-light.jpg, miniapp199-dark.jpg, miniapp199-results.jpg; composite output/Pratonton-Mini-App-199.jpg.
- Development preview: http://terminal.local:4173/preview.html (DATA CONTOH). Evidence paths are development-session files, not hosted production assets.

## Visual decisions and corrections

| Area | Observation / final result |
| --- | --- |
| Cards and lines | Rounded 22–26 px surfaces, thin mint borders, visible top accents, separators between identity, workflow and progress. |
| Progress | Real target/progress values; percentages and milestones only for finite goals. Mode HARI and continuous mode keep duration text. |
| Workflow | Prepared → current process → completion state; paused/stopped states have labels and stop their activity animation. |
| Typography | Existing bundled Sora and Jakarta retained; labels increased after review at mobile width. Counts use tabular numerals. |
| Colors | Mint brand retained; green success, amber waiting, red failure, blue delay, each with a written label. |
| Dark mode | P1 found: inherited gradient resolved light colors for the success tile. Fixed by redeclaring the gradient in dark scope, then recaptured and inspected. |
| Record action | P2 found: deletion below the ten-row results list was difficult to discover. Moved Urus Rekod directly below the campaign summary/control area. |
| Table | Number chips, status line accents and account/time metadata; long names open full detail. |
| Branding | Original robot/WA logo reused. TgLinks sales/chat/payment flows were not brought into the bot. |
| Motion | Running progress shine, flow pulse and count-to-count bar transition; reduced-motion respected. No fabricated progress increments. |
| Responsive | 393 px and 320 px preview inspected. No horizontal body overflow; navigation and controls fit. |

No unresolved P0/P1/P2 visual defect observed in the tested states.

## Interaction and regression verification

Browser: open Auto Join, pause (42/100 preserved), resume through confirmation, search Utara + Gagal (one matching result), open records, cancel deletion, reopen and delete the demo GS record, verify empty records and success feedback. Dark/light transitions inspected. All demo state is disposable and resets on reload; no WhatsApp operation is invoked.

331 automated tests passed, 0 failed, including owner/token identity, typed job IDs, existing module controls and new deletion guards. New checks cover pending reports, in-flight operations, required post cleanup, another campaign preserved, unchanged WhatsApp accounts/membership, a preview becoming stale, unauthorized owner and idempotent delete retries.

No application JavaScript error observed in browser logs; extension metadata errors originate from the browser extension, outside the app. Actual Telegram delivery and device-specific WebView behavior are not claimed as tested by this pass.
