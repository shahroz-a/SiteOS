---
name: opacity-0 + animate-in hides content
description: Entrance-animation pattern that leaves content permanently invisible when animations don't run.
---

# `opacity-0 animate-in ...` can hide content permanently

Pattern to avoid on always-present content: a base `opacity-0` utility combined with Tailwind `animate-in fade-in ... fill-mode-forwards` entrance classes (tw-animate-css / tailwindcss-animate).

**Why:** If the animation never runs, the element is stuck at the `opacity-0` base and is invisible. This happens with `prefers-reduced-motion` (the lib disables the keyframes but the `opacity-0` class stays) and in some sandboxed/iframe preview contexts. Symptom reported as "I can't see the content" even though it renders in the DOM and looks fine in a normal screenshot.

**How to apply:** For content that must always be visible, default it to visible (no `opacity-0` base). If you want an entrance reveal, gate it on an in-view state set by IntersectionObserver (start visible if no observer), or drop the entrance animation entirely. Radix `data-[state=...]:animate-in` on transient popovers/dialogs is fine — those are hidden by design until opened.
