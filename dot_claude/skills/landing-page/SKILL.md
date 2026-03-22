---
name: landing-page
description: Use when generating a Next.js landing page for a local service business or similar site — covers file structure, config conventions, Tailwind styling, and build verification requirements.
---

# Next.js Landing Page Generator

## Overview

Generates a complete, production-ready Next.js landing page. Covers the full file set (12–19 files), enforces known conventions to avoid recurring build failures, and verifies a clean build before finishing.

## Stack

- **Framework:** Next.js (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Animations:** Framer Motion (if needed)

## Critical Conventions

| Rule | Details |
|------|---------|
| Config file | `next.config.mjs` — NEVER `next.config.ts` or `next.config.js` |
| Component naming | Never use the same name for an imported component AND the page function |
| Tailwind classes | Verify every class exists in Tailwind before writing — no invented classes |
| Contrast | All text must meet WCAG AA (4.5:1 normal, 3:1 large). No low-opacity white on light bg |
| Dark mode | Check dark theme compatibility for every color decision |

## Standard File Set

```
app/
  layout.tsx
  page.tsx
  globals.css
components/
  Navbar.tsx
  Hero.tsx
  Services.tsx
  Testimonials.tsx
  CallToAction.tsx
  ContactForm.tsx
  Footer.tsx
public/          # placeholder assets if needed
next.config.mjs
tailwind.config.ts
tsconfig.json
package.json
```

## Sections to Include

1. **Navbar** — logo, nav links, mobile hamburger menu (visible on all backgrounds)
2. **Hero** — headline, subheadline, CTA button
3. **Services** — 3–6 service cards with icons
4. **Testimonials** — 2–3 customer quotes
5. **CTA** — secondary conversion section
6. **Contact Form** — name, email, message, submit
7. **Footer** — links, copyright

## UI/Styling Rules

- Apply fixes **broadly** — if one heading has a contrast issue, fix all headings in one pass
- Navbar text must be visible against ALL possible scroll states (transparent → solid)
- Use inline styles for critical visibility (e.g., hamburger icon color) when Tailwind conditionals are unreliable
- After generating all components, do a **full visual audit** for contrast, overflow, and sizing issues before finishing

## Build Verification (Required)

After all files are written:

```bash
npm install
npm run build
```

Fix any TypeScript errors, missing imports, or build warnings before declaring done. A clean build with zero errors is the success criterion.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `next.config.ts` | Rename to `next.config.mjs` |
| `import Hero from './Hero'` then `export default function Hero()` | Rename page function to `HeroPage` or similar |
| Low-opacity text (`text-white/60`) on white bg | Use solid colors with sufficient contrast |
| Navbar invisible on hero image | Force solid text color or add background on scroll |
| Invented Tailwind class | Replace with valid utility or inline style |
