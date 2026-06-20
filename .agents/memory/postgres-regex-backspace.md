---
name: Postgres regex \b is backspace, not word boundary
description: Why corpus-scan regexes that work in JS silently match nothing in Postgres.
---

In Postgres regular expressions (the `~` operator, `regexp_matches`, `regexp_match`), `\b` means a **literal backspace character**, NOT a word boundary like in JS/PCRE. A pattern such as `<div\b[^>]*class="...">` therefore matches nothing in Postgres (no backspace char in HTML), even though the identical pattern works in JS.

**Why:** A corpus scan to find empty decoration elements returned zero rows; the only difference from a working sibling query was a `\b` I had added. The working query used `\s`/literal text instead.

**How to apply:** When porting a JS regex into a Postgres `~` / `regexp_matches` corpus scan, replace `\b` with `\y` (word boundary), `\m` (start of word), `\M` (end of word), or just require an explicit `\s` / literal delimiter. Also watch out: `<tag[^>]*>\s*\S` to test "non-empty element" falsely matches the following `</tag>` (the `<`), so it can't distinguish empty from non-empty — assert against the exact empty form instead.
