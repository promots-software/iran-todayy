import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import publicCa from '../../config/database/digitalocean-production-ca.json';

/** The Node proxy has a separate bundle without route-traced certificate files.
 * Bundle only the public CA; credentials stay in memory and TLS stays strict. */
export function proxyDatabaseUrl(value:string|undefined):string|undefined {
 if(!value)return value;
 const url=new URL(value);
 if(!url.hostname.endsWith('.db.ondigitalocean.com')||!url.searchParams.get('sslcert')?.endsWith('/digitalocean-production-ca.crt'))return value;
 const digest=createHash('sha256').update(publicCa).digest('hex');
 const certificate=join(tmpdir(),`iran-today-public-ca-${digest}.crt`);
 writeFileSync(certificate,publicCa,{mode:0o600});
 url.searchParams.set('sslcert',certificate);
 return url.toString();
}
