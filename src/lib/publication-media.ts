import {createHash} from 'node:crypto';
export function validateImage(bytes:Buffer,claimed:string){
 if(bytes.length<24||bytes.length>2*1024*1024)throw new Error('IMAGE_SIZE');
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 if(png){if(claimed!=='image/png'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)>6000||bytes.readUInt32BE(20)>6000||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16000000||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')throw new Error('INVALID_IMAGE');}
 else if(!jpeg||claimed!=='image/jpeg')throw new Error('INVALID_IMAGE');
 if(jpeg){
  let at=2,dimensions=false;
  while(at+4<bytes.length){if(bytes[at++]!==255)throw new Error('INVALID_IMAGE');while(bytes[at]===255)at++;const marker=bytes[at++];if(marker===218||marker===217)break;const length=bytes.readUInt16BE(at);if(length<2||at+length>bytes.length)throw new Error('INVALID_IMAGE');
   if([192,193,194].includes(marker)){if(length<8)throw new Error('INVALID_IMAGE');const h=bytes.readUInt16BE(at+3),w=bytes.readUInt16BE(at+5);if(!w||!h||w>6000||h>6000||w*h>16000000)throw new Error('IMAGE_DIMENSIONS');dimensions=true;}
   at+=length;
  }
  if(!dimensions)throw new Error('INVALID_IMAGE');
 }
 return {mime:png?'image/png':'image/jpeg',digest:createHash('sha256').update(bytes).digest('hex')};
}
export function sourceHasMedia(metadata:unknown):boolean{if(!metadata||typeof metadata!=='object')return false;const m=metadata as Record<string,unknown>;return m.hasMedia===true||m.hasPhoto===true;}
/** Attachment presence is not a request to publish an image. Text that depends
 * explicitly on unseen visual evidence still requires editorial review. */
export function sourceMediaReviewRequired(metadata:unknown,content:string):boolean{
 return sourceHasMedia(metadata)&&/(?:كما (?:تظهر|توضح|تشاهد)|في (?:الصورة|الفيديو|المقطع) (?:تظهر|نشاهد)|شاهد(?:وا)? (?:الفيديو|الصور)|در (?:تصویر|ویدیو|فیلم)|(?:as (?:shown|seen)|see (?:the )?(?:image|video|photo)))/iu.test(content);
}
