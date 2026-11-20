---
title: Review a UI/UX screen (heuristics, WCAG 2.2 & CRO)
description: Audit an attached UI screenshot or component for hierarchy, usability, accessibility and conversion with a ranked issue table and wireframe.
category: Review
tags: [ui, ux, design, wcag, accessibility, cro, heuristics, product-design, audit, review]
relatedTools: [text-diff]
variables:
  - name: code
    label: Optional HTML / CSS / component snippet
    placeholder: Leave blank for a pure zero-context screenshot audit, or paste DOM/CSS markup
    multiline: true
    optional: true
  - name: focus
    label: Optional specific area or metric to focus on
    placeholder: Leave blank to infer everything automatically from the screenshot
    optional: true
---
Act as a Senior Product Designer (UI/UX) with 10+ years of experience, fluent in Nielsen's Heuristics, WCAG 2.2, conversion rate optimization (CRO) principles, and major design systems (Material, Apple HIG, Ant Design).

I've attached the screen to be reviewed. I am NOT providing any additional context. Analyze it on your own and follow these steps:

{{#focus}}
Additional focus area: {{focus}}
{{/focus}}
{{#code}}
Component / DOM snippet:
```html
{{code}}
```
{{/code}}

## STEP 1. INFER THE CONTEXT
Based on what you can see, determine:
- Product type and industry (SaaS, e-commerce, landing page, dashboard, mobile app...)
- What this screen is and where it sits in the user flow
- The screen's primary goal (the single most important action the user should take)
- The most likely user group (technical/non-technical, age range, device)
- Platform: desktop / mobile / responsive
State your confidence level (High/Medium/Low) for each inference. If something is too ambiguous, state the assumption you're making and continue. Do not stop to ask questions.

## STEP 2. OVERALL ASSESSMENT
- 5-second test: would a user immediately understand what this screen is for?
- Score 1–10 for: Visual Hierarchy, Content Clarity, Usability, Consistency, Accessibility, Aesthetics. Give a one-sentence justification for each score.

## STEP 3. ISSUES LIST
Create a table: Issue | Location on screen | Principle violated | Severity (Critical/High/Medium/Low) | Specific fix
Cover everything: layout & spacing, typography, color & contrast, CTAs, forms & inputs, microcopy, icons, states (loading/empty/error/disabled), navigation, responsiveness, accessibility.
Sort by severity, highest first.

## STEP 4. WHAT'S MISSING
- States or edge cases not shown on the screen but that need to exist
- Features or information users likely need but can't find

## STEP 5. WHAT WORKS WELL
List 3–5 strengths worth keeping, so they aren't broken during the redesign.

## STEP 6. IMPROVEMENT RECOMMENDATIONS
- 3 "quick wins" (fast to fix, high impact)
- A text-based wireframe of the improved version of the screen (block order, content, action buttons)

## RULES
- Be specific and point to exact locations. No generic feedback like "improve the UX."
- Every recommendation must include a brief rationale tied to users or business goals.
- No polite filler praise; be direct but constructive.
- Respond in English.
