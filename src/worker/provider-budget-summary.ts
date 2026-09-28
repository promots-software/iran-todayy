import {Prisma,type PrismaClient} from '@prisma/client';
import {pacificDay,googleQuota} from './provider-quota';
import type {CapacityRow} from './provider-capacity';
/** No audit history crosses the connection. This query runs under the existing
 * reservation advisory lock for admission; monitoring uses the identical SQL. */
export async function readBudgetSummary(db:Pick<PrismaClient,'$queryRaw'>,now:number,resource:string,requestUsd:number,inputTokens:number,hard:number){
 const day=pacificDay(now);
 const [r]=await db.$queryRaw<BudgetSummary[]>(Prisma.sql`
 WITH history AS MATERIALIZED (
 SELECT id,action,metadata,"createdAt",extract(epoch FROM "createdAt")*1000 AS at
 FROM "AuditLog" WHERE "entityType"='ProviderBudget' AND "entityId"='gemini'
 AND "createdAt">CAST(${new Date(Math.min(now-86400000,day.start)-1).toISOString()} AS timestamp)
 ), settlements AS (
 SELECT metadata->>'reservationId' AS id,
 max(CASE WHEN jsonb_typeof(metadata->'usd')='number' AND (metadata->>'usd')::numeric>=0 THEN (metadata->>'usd')::numeric END) usd,
 max(CASE WHEN jsonb_typeof(metadata->'inputTokens')='number' AND (metadata->>'inputTokens')::numeric BETWEEN 0 AND 9007199254740991 AND trunc((metadata->>'inputTokens')::numeric)=(metadata->>'inputTokens')::numeric THEN (metadata->>'inputTokens')::numeric END) tokens
 FROM history WHERE action='PROVIDER_USAGE_SETTLED' AND jsonb_typeof(metadata->'reservationId')='string' GROUP BY 1
 ), reservations AS MATERIALIZED (
 SELECT h.id,h.at,s.id IS NOT NULL AS settled,
 COALESCE(s.usd,CASE WHEN h.metadata->>'usd' ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN (h.metadata->>'usd')::numeric WHEN h.metadata->'usd'='null'::jsonb THEN 0 END) AS usd,
 CASE WHEN h.metadata->>'usd' ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN (h.metadata->>'usd')::numeric WHEN h.metadata->'usd'='null'::jsonb THEN 0 END AS reserved,
 COALESCE(s.tokens,CASE WHEN COALESCE(h.metadata->>'inputTokens',h.metadata->>'bytes') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN COALESCE(h.metadata->>'inputTokens',h.metadata->>'bytes')::numeric WHEN COALESCE(h.metadata->>'inputTokens',h.metadata->>'bytes') IS NULL THEN ${googleQuota.inputTpm} END) AS tokens
 FROM history h LEFT JOIN settlements s ON s.id=h.id WHERE h.action='PROVIDER_RESERVED'
 ), totals AS (
 SELECT COALESCE(sum(usd) FILTER(WHERE at>${now-86400000}),0) AS cost,
 COALESCE(sum(reserved) FILTER(WHERE at>${now-86400000} AND NOT settled),0) AS outstanding,
 COALESCE(bool_or(usd IS NULL OR usd<0),false) AS invalid_cost,
 COALESCE(bool_or(tokens IS NULL OR tokens<0 OR tokens>9007199254740991 OR trunc(tokens)<>tokens),false) AS invalid_quota,
 count(*) FILTER(WHERE at>${now-3600000}) AS hour,
 count(*) FILTER(WHERE at>${now-60000} AND at<=${now}) AS rpm,
 COALESCE(sum(tokens) FILTER(WHERE at>${now-60000} AND at<=${now}),0) AS tpm,
 count(*) FILTER(WHERE at>=${day.start} AND at<=${now}) AS rpd
 FROM reservations
 ), cost_boundaries AS (
 SELECT at+86400000 AS boundary,sum(sum(usd)) OVER(ORDER BY at ROWS UNBOUNDED PRECEDING) AS expired
 FROM reservations WHERE at>${now-86400000} GROUP BY at
 ), minute_boundaries AS (
 SELECT at+60000 AS boundary,sum(count(*)) OVER(ORDER BY at ROWS UNBOUNDED PRECEDING) AS expired_count,
 sum(sum(tokens)) OVER(ORDER BY at ROWS UNBOUNDED PRECEDING) AS expired_tokens
 FROM reservations WHERE at>${now-60000} AND at<=${now} GROUP BY at
 ), last_block AS (
 SELECT * FROM history WHERE action='PROVIDER_CAPACITY_BLOCKED' AND metadata->>'resource'=${resource} ORDER BY "createdAt" DESC,id DESC LIMIT 1
 ), capacity_rows AS (
 SELECT action,metadata,"createdAt" FROM last_block
 UNION ALL (SELECT action,metadata,"createdAt" FROM history WHERE action='PROVIDER_CAPACITY_HEALTHY' AND metadata->>'resource'=${resource}
 AND CASE WHEN metadata->>'requestStartedAt' ~ '^[0-9]+([.][0-9]+)?$' THEN (metadata->>'requestStartedAt')::numeric END >=(SELECT at FROM last_block) ORDER BY "createdAt" DESC,id DESC LIMIT 1)
 UNION ALL (SELECT action,metadata,"createdAt" FROM history WHERE action='PROVIDER_CAPACITY_PROBE' AND metadata->>'resource'=${resource} AND "createdAt">=(SELECT "createdAt" FROM last_block) ORDER BY "createdAt" DESC,id DESC LIMIT 1)
 )
 SELECT cost::float8 AS "accountedUsd",outstanding::float8 AS "outstandingUsd",invalid_cost AS "invalidCost",invalid_quota AS "invalidQuota",
 hour::int AS "hourUsed",rpm::int AS rpm,tpm::float8 AS "inputTpm",rpd::int AS rpd,
 CASE WHEN cost+${requestUsd}<=${hard} THEN 0 ELSE COALESCE((SELECT greatest(1000,min(boundary)-${now}) FROM cost_boundaries WHERE totals.cost-expired+${requestUsd}<=${hard}),86400000) END::float8 AS "budgetWaitMs",
 COALESCE((SELECT greatest(1,min(boundary)-${now}) FROM minute_boundaries WHERE totals.rpm-expired_count<${googleQuota.rpm} AND totals.tpm-expired_tokens+${inputTokens}<=${googleQuota.inputTpm}),60000)::float8 AS "minuteWaitMs",
 COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM capacity_rows c),'[]'::jsonb) AS "capacityRows",
 (SELECT count(*)::int FROM history WHERE action='PROVIDER_HTTP_DIAGNOSTIC' AND at>${now-86400000} AND metadata->>'httpStatus' IN ('429','500','502','503','504')) AS "transientFailures24h",
 (SELECT metadata FROM history WHERE action='PROVIDER_HTTP_DIAGNOSTIC' ORDER BY "createdAt" DESC,id DESC LIMIT 1) AS diagnostic
 FROM totals`);
 return {...r,capacityRows:r.capacityRows.map(x=>({...x,createdAt:new Date(/[zZ]|[+-]\d\d:\d\d$/.test(String(x.createdAt))?String(x.createdAt):String(x.createdAt)+'Z')})),resetAt:day.end};
}
export type BudgetSummary={accountedUsd:number;outstandingUsd:number;invalidCost:boolean;invalidQuota:boolean;hourUsed:number;rpm:number;inputTpm:number;rpd:number;budgetWaitMs:number;minuteWaitMs:number;capacityRows:CapacityRow[];transientFailures24h:number;diagnostic:unknown};
export function summaryQuota(r:BudgetSummary&{resetAt:number},input:number,now:number){
 const usage={rpm:r.rpm,inputTpm:r.inputTpm,rpd:r.rpd,resetAt:r.resetAt};
 if(r.invalidQuota||!Number.isSafeInteger(input)||input<0||input>googleQuota.inputTpm)return {...usage,reason:'PROVIDER_INPUT_LIMIT',waitMs:0};
 if(r.rpd>=googleQuota.rpd)return {...usage,reason:'PROVIDER_RPD_WAIT',waitMs:r.resetAt-now};
 if(r.rpm>=googleQuota.rpm||r.inputTpm+input>googleQuota.inputTpm)return {...usage,reason:r.rpm>=googleQuota.rpm?'PROVIDER_RPM_WAIT':'PROVIDER_TPM_WAIT',waitMs:r.minuteWaitMs};
 return {...usage,reason:null,waitMs:0};
}
