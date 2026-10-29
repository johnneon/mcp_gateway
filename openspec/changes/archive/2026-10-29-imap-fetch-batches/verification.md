# imap-fetch-batches

## Result
blockers: 0

## Spec
- Gmail list_messages tool: met
- Gmail search_messages tool: met
- Mail.ru list_messages tool: met
- Mail.ru search_messages tool: met

## Checks
- tests: passed — 412 server + 51 web on Node v22.14.0 (`C:\Users\User\AppData\Local\nvm\v22.14.0`). `npx openspec validate imap-fetch-batches` passed. Both tasks in `tasks.md` are checked.
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: `git diff origin/main...HEAD` stays inside this change and `server/src/connectors/mail/imap.ts` plus its fakes and tool tests. It does not edit `mcp-gateway-spec.md`, `openspec/specs/`, or `web/`. No assertion was removed. No explicit `any`. Hosts stay in connector code. `fetchMessage` and the flag read still fetch one UID. `pageMessages` still sorts and pages after `fetchSummaries`.
- note: the admin page logs `favicon.ico` 404. That request is outside this delta.

## E2E
- Default call returns the full newest set inside an envelope: passed — `gmail_list_messages` and `mailru_list_messages` each returned 21 summaries, offset 0, limit null, total 21; first uid 1 seen; last uid 2 unseen; one `UID FETCH` within 4096 bytes; password absent
- Offset and both orders page a mailbox: passed — newest pages 5 then 7, then 8 then 6; oldest pages 6 then 8, then 7 then 5; `to` present
- List returns capped summaries without bodies on a fake IMAP server: passed — limit 80 returned 60 messages, uid 60 down to 1, no body
- Provided limit is honored with no maximum: passed — oldest limit 2 returned uids 1 then 2
- Unparseable dates sort as oldest: passed — newest uids 2, 3, 1; oldest uids 1, 3, 2; limit null
- Invalid offset and limit return the full remainder: passed — limit 0 and limit 1.5 both applied offset 0 and limit null
- Offset past the end returns an empty page: passed — offset 5 with limit 20 and with no limit both returned an empty `messages` array and total 1
- Unknown order is rejected: passed — error contained `Invalid order`; fake SEARCH count stayed 0
- Sent, Drafts, Spam, and Trash are listed by server mailbox name: passed — `Sent Items`, `Drafts`, `Spam`, `Deleted Items`; subjects matched; result did not contain `[Gmail]/`
- Large mailbox summary fetch stays within the command budget: passed — total 1100, full newest order starting 1100, 1099, 1098 and ending at 1; page limit 2 returned 1100 then 1099; more than one `UID FETCH`, each at most 4096 bytes, naming uids 1 through 1100 once; no `1:*` or UID range; no body; password absent
- Narrow filter search returns matching summaries on a fake IMAP server: passed — filter from `alice@example.test` returned 3 alice summaries, limit null
- Search applies paging and order after the filter: passed — oldest page uids 3 then 4; newest remainder uid 3; bob excluded
- Unknown search order is rejected: passed — `Invalid order`; SEARCH not issued
- Free-form IMAP search syntax is rejected: passed — a string filter and filter key `raw` failed; no new SEARCH
- Filtered summary fetch stays within the command budget: passed — total 400 alice uids, newest order starting 1000000799, 1000000797, 1000000795 and ending at 1000000001; page limit 2 returned those first two; batches named each alice uid once and no bob uid; each command at most 4096 bytes; no `1:*` or UID range; password absent
- Foreign and disabled account: passed — `list_messages` for both ids failed with `Invalid tool arguments` (the account enum lists only eligible accounts); fake TLS session count stayed 0
- tools/list exposes the delta tools: passed — `gmail_list_messages`, `gmail_search_messages`, `mailru_list_messages`, and `mailru_search_messages`; schemas had no host, URL, secret, password, or command
- Empty and unknown bearer identical rejection: passed — both 401 with the same body; fixture password absent
- MCP vs admin port separation: passed — admin `/mcp` 404; MCP `/api/connectors` 404; MCP `/health` returned `{"status":"ok"}`
- Admin configurations empty state: passed — heading `Configurations`; text `No configurations yet. Create one to get a bearer token.`; Create disabled
- Admin connectors empty state: passed — `Gmail` and `Mail.ru` each showed `No accounts yet.`
- Admin connection check failure: passed — wrong Gmail password showed `Connection check failed`; the account list stayed `No accounts yet.`
- Admin account create and edit: passed — `Gmail inbox` showed `address: user@gmail.com`; `Mail.ru inbox` showed `address: user@mail.ru`; Edit said `Secret fields stay blank on edit to keep the stored value.`; App password value length was 0; after Cancel the dialog was gone
- Admin connection check: passed — both account check requests returned 200 and the page showed no alert
- Admin bearer reveal: passed — dialog `Bearer token` with `Copy this token now. It will not be shown again after you close this dialog.`; after Close the dialog and the raw bearer were gone; `GET /api/configurations` keys were `id`, `name`, `enabled`, `accountIds`

No live Gmail or Mail.ru host was contacted. The fake IMAP duplex from this change backed every tool call. Observed TLS targets were `imap.gmail.com:993`, `smtp.gmail.com:465`, and `imap.mail.ru:993`.

## Leaks
- admin UI DOM on Configurations and Connectors: clean
- admin edit dialog input values, including App password: clean
- admin UI DOM after Cancel and after the bearer dialog Close: clean
- admin API accounts list and configurations list: clean
- MCP tools/list and tools/call results: clean
- MCP error text for invalid order, free-form search, foreign account, and disabled account: clean
- browser console (aside from favicon 404 and the expected 400 on the failed create): clean
