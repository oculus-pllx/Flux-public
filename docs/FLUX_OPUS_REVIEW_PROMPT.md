# Flux — Opus Final Review Prompt
> Copy and paste this prompt into CC after switching to Opus (`/model`) and after
> Sonnet's implementation has been visually verified in the browser.
> This is a qualitative review, not a checklist pass.

---

## The Prompt

```
You are doing a final quality review of Flux, a NUT UPS monitoring web application
that is part of the Parallax Group ecosystem. Two reference documents are in the
project root — read both carefully before doing anything else:

  - Pllx_group_BRAND.md   (ecosystem brand reference)
  - FLUX_BRAND_BRIEF.md   (Flux-specific implementation spec)

This review has four parts. Work through them in order. Do not make any changes
without telling me first — this is a review pass, not an implementation pass.
Flag everything, then we will decide together what to action.

---

PART 1 — BRAND INTEGRITY

Read every frontend source file in /frontend/src. For each of the following,
tell me what you find and whether it matches the brief:

1. Color usage — are all colors coming from --flux-* CSS custom properties?
   Are there any hardcoded hex values, Tailwind slate/gray/emerald defaults,
   or other colors that should have been replaced?

2. Typography — is Syne applied to all headings, wordmarks, and labels?
   Is IBM Plex Mono applied to all metric values and data readouts?
   Is IBM Plex Sans applied to all body copy? Any exceptions?

3. The Parallax Shift mark — review the ParallaxMark component.
   Does the SVG construction match the brand spec (front chevron 90% opacity,
   back chevron 30%, depth connectors 15% dashed at >=32px)?
   Does it render at the right sizes in the navbar and login screen?

4. Accent discipline — is orange (#f97316) used purposefully and only where
   the brief specifies? Or is it appearing decoratively or inconsistently?

5. Glow effects — are they present only on interactive/hover states and active
   alert indicators? Any decorative or excessive glow usage?

6. Light mode — confirm the toggle has been fully removed. No remnant state,
   no remnant UI element, no light: Tailwind variants anywhere in the codebase.

---

PART 2 — NAMING & CONSISTENCY

1. Search the entire codebase for any remaining instance of: nut-monitor,
   NUT Monitor, NutMonitor, nut_monitor. Report every file and line if found.

2. Verify the component taxonomy is applied in file header comments:
   Conduit, Core, Cycle, Surge, Tap, Signal, Lock, Stratum.
   Are all eight present and correctly attributed to their files?

3. Check all package.json files, docker-compose.yml, and any CI/config files
   for correct naming: @pllx/flux, pllx/flux-backend, pllx/flux-frontend.

4. Check the footer renders: "Flux by Parallax Group © 2026"
   Check the navbar renders: compact mark + "Flux" only
   Check the login screen renders: full mark + "Flux" + "by Parallax Group"

---

PART 3 — NATIVE INSTALL

1. Review install.sh — is it complete, correct, and executable?
   Does it check for Node 18+, install PM2, build the frontend, and
   copy .env.example correctly?

2. Review install.ps1 — same check for Windows PowerShell.

3. Review backend/ecosystem.config.js — is PM2 config correct for
   the flux-core process?

4. Review root package.json scripts — are start, stop, restart, logs,
   build, dev:backend, dev:frontend all present and correct?

5. Is there a native install section in README.md alongside the Docker
   instructions? Is it clear and accurate?

---

PART 4 — QUALITATIVE ASSESSMENT

This is the most important part. Go beyond the checklist.

1. Open and read the main Dashboard, Device Detail, Alerts, and Login pages.
   Does the overall aesthetic feel like it belongs in the Parallax Group
   ecosystem — dark, purposeful, mission control? Or does it still feel like
   a generic Tailwind app with a coat of paint?

2. Look at how UPS metric values are displayed. Do they feel like instrument
   readouts — monospaced, precise, data-forward? Or do they look like
   ordinary web content?

3. Evaluate the status color usage (healthy/warning/critical). Is the
   system communicating clearly and consistently? Any ambiguity or misuse?

4. Is there anything in the codebase that is technically correct per the
   brief but feels wrong in spirit — something that would look out of place
   in a professional infrastructure tool?

5. If you were a network engineer or sysadmin opening this app for the first
   time, what would your honest impression be? What would you question?

---

DELIVER YOUR FINDINGS AS:

A structured report with four sections matching the four parts above.
For each issue found, state:
  - File and line (if applicable)
  - What is wrong or questionable
  - What it should be
  - Priority: MUST FIX / SHOULD FIX / CONSIDER

End with an overall assessment: is Flux ready to push to github.com/pllx/flux,
or are there blockers that need resolving first?

Do not make any changes until I review your report and tell you what to action.
```

---

## After the Report

Once Opus delivers its findings, review the MUST FIX items first. For each one,
decide in this chat whether to action it, then tell CC:

```
Action all MUST FIX items from your report. Check in after each one.
Do not move to SHOULD FIX items until I confirm.
```

Keep SHOULD FIX and CONSIDER items for a separate pass — don't let them
block the initial push to GitHub.

---

*Flux by Parallax Group · pllx.group · Opus Review Prompt Rev 1 · April 2026*
