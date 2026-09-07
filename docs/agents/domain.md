# Domain docs

The BRAVOS project uses a single-context layout.

## Before exploring

- Read root `CONTEXT.md` for the domain glossary when it exists.
- Read relevant decisions in `docs/adr/` before changing the affected area.
- If a root `CONTEXT-MAP.md` is introduced later, follow it to the relevant context documents and decisions.

If these documents do not exist, proceed silently. Do not report their absence or suggest creating empty placeholders. The `domain-modeling` skill creates them when terms or decisions are resolved.

## File structure

- `bravos.md`: business-requirements baseline.
- `CONTEXT.md`: domain glossary, created when terminology is resolved.
- `docs/adr/NNNN-<decision>.md`: architectural decision records, created when decisions are made.
- `docs/planning/kickoff.md`: initial work sequence and open decisions; this does not replace the requirements or glossary.

## Use the glossary's vocabulary

Use the terms defined in `CONTEXT.md` in issue titles, proposals, tests, and implementation. Avoid synonyms the glossary rejects.

If a needed concept is absent, check whether the project already has a term for it. Record a real terminology gap for `domain-modeling` rather than inventing a definition silently.

## Flag decision conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain why the decision needs reconsideration. Do not silently override it.

Keep the distinction between shared central inventory, branch operations, and online orders explicit.
