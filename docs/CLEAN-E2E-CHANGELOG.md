# Clean post-reset E2E fixes — 2026-09-20

- Baseline: 6dff4b7; only post-reset evidence examined.
- Al Alam 504142: model changed NBSPs outside the exact claim into spaces. Restore uniquely matching source context using only equal-length NBSP/narrow-NBSP/space equivalence. Excerpts, original text, punctuation and evidence uniqueness remain strict. Saved extraction now validates locally without another extraction call.
- ISNA 404969: explicit Strait of Hormuz alias was absent. Add Arabic/Persian/English aliases for coverage only, not country ownership or parliament identity. Geographic reference: https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/ . Generic parliament / Gulf alone remains uncertain.
- Source profiles: independently researched identity evidence plus explicit user approval. ISNA stays UNKNOWN by explicit instruction. Al Alam IRAN_OFFICIAL/OFFICIAL, IRNA IRAN_OFFICIAL/AGENCY. No individual claim becomes verified by source identity.
- Source attachments alone no longer impose an optional-publication-image decision. Explicit visual-dependent text remains reviewable. Original media and human media/approval checks are retained. Dashboard routing follows editorial eligibility, not attachment presence.
- Gemini draft atom ordering is local, includes all validated facts and passes the same final validators. Persian path reduces from five to four justified requests; Arabic from three to two before any semantic comparisons. No translation or semantic review removed.
- Budget rejection computes the first safe rolling reservation expiry rather than always delaying one hour. Hard limits remain 12/hour, 48/day and $1/day reserved; capacity changes require measurements after optimization.
- Matcher already filters candidates by grounded actor/fact overlap and caches equal comparison inputs. No semantic matching safety weakened or arbitrary candidate truncation added.
- Source/profile or budget changes never approve, publish, rewrite source evidence or retroactively clear review flags.
