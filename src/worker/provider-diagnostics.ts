/** Allowlisted identity only: raw exception messages and metadata may contain secrets. */
export function providerFailureDiagnostic(error:unknown){
 const e=error as {name?:unknown;code?:unknown;message?:unknown;cause?:unknown}|null;
 const names=new Set(['Error','TypeError','RangeError','AbortError','TimeoutError','ProcessingError','PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientInitializationError','PrismaClientRustPanicError']);
 const name=typeof e?.name==='string'&&names.has(e.name)?e.name:'UnknownError';
 const code=typeof e?.code==='string'&&/^(?:P\d{4}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|PROVIDER_[A-Z_]+|GEMINI_HTTP_\d{3}|GEMINI_TRANSPORT_FAILED)$/.test(e.code)?e.code:null;
 const message=typeof e?.message==='string'?e.message:'';
 const reason=/Unable to start a transaction in the given time/i.test(message)?'TRANSACTION_ACQUISITION_TIMEOUT':/Transaction already closed|expired transaction|transaction.*expired/i.test(message)?'TRANSACTION_EXPIRED_OR_CLOSED':/Timed out fetching a new connection/i.test(message)?'CONNECTION_POOL_TIMEOUT':/deadlock detected/i.test(message)?'DEADLOCK':null;
 const cause=e?.cause&&e.cause!==error?e.cause as {code?:unknown}:null;
 const causeCode=typeof cause?.code==='string'&&/^(?:P\d{4}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/.test(cause.code)?cause.code:null;
 return {errorType:name,errorCode:code,errorReason:reason,causeCode};
}
