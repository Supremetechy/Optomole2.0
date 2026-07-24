Confidence policy (tailored to highly customizable services)

Use a policy that favors operational correctness for “right now” over completeness.
A) Confidence is computed per-field, not globally

Each field gets:

    confidence_score (0–1) or tiers (high/med/low)
    current_status derived from freshness + confidence

B) Separate “evidence strength” from “freshness”

Compute confidence from two components:

    Evidence strength (E): how directly the info came

    Explicit user statement / direct preference input: highest
    Direct observation (logged user behavior in the relevant context): high
    Credential/documentation: high for facts that don’t change quickly
    Third-party inference (e.g., “likely”): medium
    Model inference not directly supported: low

    Freshness factor (F): how recently it applies

    Use a decay curve or step function.
    Example:
        updated within freshness window → F≈1
        somewhat older → F decreases
        beyond max staleness → current_status becomes stale/outdated/unknown

Then:

    confidence_score = E × F (and optionally capped if field is disputed)

C) “Confidence tiers” tuned for customization risk

Map to actionability:

    Tier 1 (High): safe to personalize aggressively
        apply defaults tailored to this field
    Tier 2 (Medium): personalize with opt-out / soft customization
        offer variants, but keep a “neutral fallback”
    Tier 3 (Low): don’t treat as a factual constraint
        use as a ranking hint only; do not block options

D) Prefer “verified current” over “possibly true past”

For “current status”:

    If you have an older high-confidence fact but no recent confirmation, treat it as non-binding.
    Bind only when:
        evidence is recent enough and
        evidence strength is strong enough.

E) Use different thresholds by field criticality

    Preferences affecting UX (“tone”, “format”) can tolerate medium confidence.
    Capabilities affecting feasibility (“can deliver language X”, “meets requirements”) need higher thresholds.
    Critical restrictions need the highest tier; otherwise route to “safe generic offering” rather than guessing.

F) Track “method risk” in confidence

Downweight values that depend on:

    ambiguous user language
    inferred categories (vs explicitly chosen)
    behavior patterns that can be explained by context (one-off browsing, etc.)

Conflict rules (designed for “current status” and customer experience)

Conflicts aren’t exceptional—they’re expected. Your system should resolve them deterministically while preserving auditability.
A) Define conflict types

    Contradiction about the same current attribute (e.g., “prefers English” vs “prefers Spanish”)
    Time mismatch (same attribute changes over time)
    Scope mismatch (preference is for one context: “mobile only” vs “all devices”)
    Entity mismatch (data may belong to different persons)
    Evidence mismatch (different sources agree on time but not content)

B) Resolution hierarchy (recommended order)

For any field X at time t:

    Prefer “explicit current” user input over inferred/model data
    Prefer primary/direct evidence over third-party claims
    Prefer more recent evidence if the evidence strength difference isn’t overwhelming
    If evidence is equally old/strong and conflicts remain:
        mark field as disputed
        downgrade to Medium/Low confidence
        use safe personalization: show options instead of blocking

C) Time-scoped resolution (“current” means choose the winning evidence by recency)

    If the conflict appears to be a change, represent it as:
        current value = most recent within freshness window
        previous value = keep as history (not active)
    Do not average conflicting values for current status.

D) Context-scoped resolution

If evidence suggests different values apply under different contexts:

    store multiple preference instances with context tags (device/channel/time/activity segment)
    only apply the one that matches the current session context
    confidence applies per-instance, not averaged across contexts

E) Disputed entity rules (prevent cross-person contamination)

If linkage uncertainty is present:

    set identity_linkage_status to disputed/low
    reduce personalization aggressiveness globally:
        use generic offerings
        request confirmation for key fields
    never merge preferences/capabilities across likely different persons without a merge review state.

F) Service delivery behavior when conflicts exist

Use these safe defaults:

    For hard feasibility requirements: don’t guess—route to options that don’t depend on the conflicted field, or ask a fast question.
    For preferences: offer choice-based personalization (A/B variants) rather than asserting one value.
    For critical constraints: treat as unknown unless supported by high-tier recent evidence.

G) Auditability requirement

Every resolved field should store:

    which evidence won (and why)
    whether conflict was collapsed into a single “current” value or represented as context-dependent/disputed
    whether evidence was primary, secondary, or inferred

operational loop (how the node stays accurate)

    Intake evidence (explicit input, observation logs, docs, third-party)
    Update claim objects with evidence links + timestamps
    Recompute confidence per field with freshness decay
    Detect conflicts
    Resolve using hierarchy + context rules
    Publish a new as_of snapshot
    Periodically re-verify high-impact fields (capabilities, critical constraints)
