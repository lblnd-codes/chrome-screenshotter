# Instagram Carousel Slide Detection — Debugging History

This document traces the full debugging journey for detecting which slide is currently visible in an Instagram carousel, from initial implementation through to the working dual-transform approach.

---

## Goal

When taking a screenshot of an Instagram carousel post, append the current slide number to the filename:

```
username - postId - 2.png
```

Non-carousel posts are unaffected (`slide` remains `null`, nothing is appended).

---

## Iteration 1 — Initial Implementation (`b457371`)

**Commit:** `Append slide number to Instagram carousel screenshots`

Two strategies were implemented:

1. **`aria-label` "X of Y"** — Instagram labels carousel items with e.g. `"Photo 2 of 5"`. A simple `querySelector('[aria-label*=" of "]')` + regex was enough to extract the position.
2. **`translateX` on the `<ul>`** — The carousel `<ul>` was expected to be translated proportionally to the current slide. Parsing the `translateX` value and dividing by slide width would give a 0-based index.

This worked in basic cases but failed in more complex layouts (Explore modal, full-page posts).

---

## Iteration 2 — More Strategies (`a1aada6`)

**Commit:** `Add more carousel slide detection strategies for Instagram`

The original two strategies weren't matching Instagram's current DOM in all contexts. Four fallbacks were added:

| Strategy | Mechanism |
|---|---|
| ARIA tablist | `role="tablist"` + `role="tab"` with `aria-selected="true"` — dot indicators |
| `translateX` on `div` children | Instagram uses both `<ul>` and `<div>` wrappers |
| `scrollLeft` | Read the scroll offset of the carousel container |
| Bounding rect center | Which `li`'s rect straddles the container midpoint |
| `aria-hidden` | The visible slide does not have `aria-hidden="true"` |

---

## Iteration 3 — URL param + Username fallback (`8c236b3`)

**Commit:** `Fix Instagram slide detection and unknown username on full-page posts`

**Two separate fixes:**

**Slide:** Instagram sets `?img_index=N` in the URL when navigating a carousel (in direct post views). This is the most reliable signal — read it first before touching the DOM.

**Username:** The existing header selectors (`div[role="dialog"] header a`, `article header a`) don't match the full-page post layout. Added a fallback that scans all `a[href^="/"]` links for the Instagram username pattern (`/word/`, 2–30 chars), skipping known reserved path segments (`explore`, `reels`, `direct`, `accounts`, etc.).

---

## Iteration 4 — Fixes for Explore Modal Always Returning Slide 1 (`dc81874`)

**Commit:** `Fix carousel always returning slide 1 on Instagram Explore modal`

Three distinct bugs were fixed:

**Bug 1 — `translateX` reading inline style only:**
`el.style.transform` reads only the inline `style` attribute. Instagram uses CSS-class-based transitions so the inline style is empty. Fixed to use `getComputedStyle().transform` and parse the `matrix()` form.

**Bug 2 — Wrong width divisor:**
The code divided by `ul.offsetWidth` (the full scroll width of the entire carousel) instead of the clipping container width. Fixed to use `parentElement.offsetWidth`.

**Bug 3 — `aria-hidden` false positive:**
If Instagram doesn't set `aria-hidden="true"` on hidden slides, `findIndex` always returns `0` → slide 1, even when not on slide 1. Added a guard: strategy only runs when at least one `li` explicitly has `aria-hidden="true"`.

---

## Iteration 5 — Strategy Ordering Bug (`55fb94a`)

**Commit:** `Fix carousel slide always reporting 1 on Explore modal`

**Root cause:** Strategy 1 (`aria-label 'X of Y'`) used `querySelector` which returns the **first match in DOM order** — always slide 1's element regardless of which slide is actually visible. The same risk applied to the tablist strategy.

**Fixes:**
- Position-based strategies (computed transform, scrollLeft, bounding rect) moved **before** ARIA attribute strategies, so they run first and short-circuit before any stale ARIA value interferes.
- Strategy 4 (`aria-label`): now iterates **all** matches and skips elements with zero width or outside the viewport, so only the visible slide's label wins.

---

## Iteration 6 — Debug Logging Added (`9439794`, `6d4c732`, `b794cf1`)

**Commits:** `Add carousel debug logging`, `Replace strategy debug with structural UL/parent/li dump`, `Add targeted debug for li attrs, aria-labels, aria-posinset, aria-current`

The Explore modal was still broken. Debug logging was added to `console.log` the internal state and understand Instagram's actual DOM structure. Three rounds of progressively more targeted logging:

1. General strategy trace (`_dbg` array logging which strategy fired and what values it saw).
2. Structural dump of every `ul` found, its parent, and each `li`'s `offsetWidth` / transform.
3. Targeted dump of:
   - Each `li`'s full attribute list (to find what Instagram uses to mark position)
   - All `[aria-label]` elements containing numbers
   - All `[aria-posinset]` / `[aria-setsize]` elements

**Key finding from the structural dump:**

> Each `li` has its own transform. The currently visible slide has `computed tx ≈ 0`. However the **absolute position** in the carousel is encoded in the `li`'s **inline `style.transform`**, not in the `ul`'s transform or a scroll offset.
>
> Example — slide 2 of a 256px-wide carousel:
> - `getComputedStyle(li).transform` → `matrix(1,0,0,1, 0, 0)` (tx = 0, this is the visible one)
> - `li.style.transform` → `translateX(256px)` (absolute position = index 1 = slide 2)

A broken ancestor `scrollLeft` approach had also been tried based on an earlier read of the dump (`scrollLeft=256, offsetWidth=256 → slide 2`) but this turned out to be unreliable across contexts.

---

## Iteration 7 — Ancestor scrollLeft Attempt (`5f3f9bc`)

**Commit:** `Fix Instagram carousel slide detection using ancestor scroll container`

Based on the debug dump, attempted to walk up from the `<ul>` to find the **scroll container ancestor** (where `scrollWidth` is a whole-number multiple of `offsetWidth`) and use `scrollLeft / offsetWidth` as the 0-based index.

This worked in the specific debug session but proved unreliable — the ancestor detection logic wasn't robust and would miss or misidentify the container across different page layouts.

---

## Iteration 8 — Dual-Transform Approach (Final Fix) (`10e80cc`)

**Commit:** `Fix Explore carousel slide via dual-transform approach`

**The correct mental model**, confirmed from debugging:

Instagram applies **two transforms** to each carousel `<li>`:

1. **CSS class `translate` property** — offsets the item back to the visual origin so it appears correctly positioned on screen. The currently visible slide will have a computed `translateX ≈ 0`.
2. **Inline `style.transform: translateX(Xpx)`** — encodes the item's **absolute position** in the carousel scroll space. `X / slideWidth` gives the 0-based index.

**Algorithm:**
1. For each `<ul>` in the carousel scope, find the `li` whose `getComputedStyle().transform` resolves to `translateX` closest to 0 — this is the visible slide.
2. Read that same `li`'s `style.transform` (inline) to get the absolute position.
3. `slide = Math.round(inlineTx / slideWidth) + 1`

```
Slide 2: computed tx=0, inline tx=256px, slideWidth=256 → slide 2
Slide 5: computed tx=0, inline tx=1024px, slideWidth=256 → slide 5
```

The broken ancestor-scrollLeft strategy was removed. Debug logging was removed. Strategies 3–6 (bounding rect, aria-label, tablist, aria-hidden) remain as fallbacks.

---

## Final Strategy Order (current `background.js`)

| # | Strategy | When it fires |
|---|---|---|
| 0 | `?img_index=N` in URL | Direct post view with URL navigation |
| 1 | Dual-transform on `li` | Explore modal, full-page post, most layouts |
| 2 | Bounding rect center | Fallback if transforms aren't set |
| 3 | `aria-label` "X of Y" (visible elements only) | Fallback |
| 4 | `role="tablist"` dot indicators | Fallback |
| 5 | `aria-hidden="true"` on hidden slides | Guarded fallback |
