import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {ProcessingError} from './contracts';

/** Local tooling only. The production worker reads its key from runtime env. */
export function readLocalGeminiKey(path='.env') {
  try {
    const key=parseEnv(readFileSync(path,'utf8')).GEMINI_API_KEY;
    if(!key || key.length>4096 || /[\s\x00-\x1f\x7f]/.test(key))throw Error();
    return key;
  } catch {throw new ProcessingError('GEMINI_API_KEY_REQUIRED');}
}
