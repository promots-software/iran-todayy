/** Versioned style guidance. Semantic evidence and protected spans take precedence. */
export const IRAN_NOW_STYLE_PROFILE_V1 = {
 version:'IRAN_NOW_STYLE_PROFILE_V1',
 authority:['rules.ts: R unified reference','rules.ts: P Publishing Prompt','client Telegram text-format specification'],
 corpus:{sha256:'da16d069d3a3810748cecccb78e560280162c4d31cffbedbf7261ec16645fb0d',records:7019,uniqueTexts:6769,pairedSourceGold:0,dateRangeVerified:false,
  branded:6950,multiline:3911,blankLine:3165,attributionHeadings:2586,bullets:2580,hashtags:45,emoji:2,
  headlineCharacterQuantiles:[41,68,107,185],bodyCharacterQuantiles:[104,198,324,690]},
 modelGuidance:[
  'Write concise professional Modern Standard Arabic for Iran Now. Use an informative headline; do not force paraphrasing of a clean short FLASH.',
  'Corpus length tendencies are descriptive, not limits: headline median 68 characters, body median 198 among multiline messages. Preserve all material facts even when longer.',
  'Use concise paragraphs for distinct material assertions. Avoid repeating the headline in the body. A title-only FLASH is valid; never fabricate a body.',
  'Keep explicit speaker attribution and claim ownership. Speaker-first or statement-first is permitted only when equivalent. Use correct institutional grammatical agreement. Never invent a statement, briefing, interview or other source medium.',
  'Preserve literal quotations byte-for-byte; translations are not literal source quotations. Preserve numbers, calendar identity, dates, locations, conditions, negation, chronology, uncertainty and cause/effect.',
  'Clean awkward Arabic only without changing factual scope. Persian-to-Arabic renderings must preserve complete meaning and pass the existing independent review.',
  'Use Arabic punctuation outside protected quotations. No headline terminal full stop, repeated emphatic punctuation, added emojis, forced hashtags, sensational adjectives or unsupported background.',
  'Apply only the supplied evidence-supported terminology rules. Historical typos and malformed branding are not rules. Do not invent currency conversions, dates, identities or geopolitical relationships.',
  'Do not generate branding or transport markup. The application supplies exactly one Iran Now prefix. Style never overrides semantic safety.',
 ],
} as const;
export const iranNowStyleInstructions=IRAN_NOW_STYLE_PROFILE_V1.version+'\n'+IRAN_NOW_STYLE_PROFILE_V1.modelGuidance.join('\n');
