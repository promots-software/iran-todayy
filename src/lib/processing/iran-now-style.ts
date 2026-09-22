import {editorialContract,EDITORIAL_CONTRACT_SHA256} from './editorial-contract';
/** Versioned style guidance. Semantic evidence and protected spans take precedence. */
export const IRAN_NOW_STYLE_PROFILE_V1 = {
 version:'IRAN_NOW_STYLE_PROFILE_V1',
 revision:EDITORIAL_CONTRACT_SHA256,
 authority:['config/editorial/iran-now-contract.txt — complete user contract'],
 corpus:{sha256:'da16d069d3a3810748cecccb78e560280162c4d31cffbedbf7261ec16645fb0d',records:7019,uniqueTexts:6769,pairedSourceGold:0,dateRangeVerified:false,
  branded:6950,multiline:3911,blankLine:3165,attributionHeadings:2586,bullets:2580,hashtags:45,emoji:2,
  headlineCharacterQuantiles:[41,68,107,185],bodyCharacterQuantiles:[104,198,324,690]},
 modelGuidance:[editorialContract],
} as const;
export const iranNowStyleInstructions=editorialContract;
