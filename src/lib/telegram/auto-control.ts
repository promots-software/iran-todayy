import {autoPolicySchema} from './auto-policy';

type Heartbeat={lastSeenAt:Date;lastError:string|null;metadata:unknown}|null|undefined;
export function automaticControlState(raw:unknown,paused:boolean,heartbeat:Heartbeat,now=new Date()){
 const parsed=autoPolicySchema.safeParse(raw),policy=parsed.success?parsed.data:null;
 const m=heartbeat?.metadata&&typeof heartbeat.metadata==='object'?heartbeat.metadata as Record<string,unknown>:{};
 const fresh=!!heartbeat&&now.getTime()-heartbeat.lastSeenAt.getTime()<45000&&now.getTime()>=heartbeat.lastSeenAt.getTime();
 const capabilities=fresh&&!heartbeat?.lastError&&m.autoPublish===true&&m.shadowMode===false&&m.requireApproval===true&&m.externalPublishingEnabled===true&&!!policy&&m.destination===policy.destination;
 const observed=!!policy&&m.policyId===policy.id&&m.policyState===policy.state;
 const enabled=!!policy&&policy.state==='ACTIVE'&&!paused&&capabilities&&observed;
 const recovering=policy?.state==='CLOSED'&&policy.reason==='TEMPORARY_RECOVERY'&&!!policy.recovery;
 const presentation=paused?'EMERGENCY_PAUSE':recovering?'TEMPORARY_RECOVERY':policy?.state==='ACTIVE'?'ACTIVE':policy?.reason==='OPERATOR_DISABLED'?'OPERATOR_DISABLED':'SYSTEMIC_SAFETY_STOP';
 return {presentation,recovering,policy,fresh,capabilities,observed,enabled,shadowMode:m.shadowMode,deliveryEnabled:m.externalPublishingEnabled,
  canAcknowledge:!!policy&&policy.state==='CLOSED'&&['DELIVERY_PERSISTENCE_OR_SAFETY_FAILURE','DELIVERY_RECONCILIATION_REQUIRED','SYSTEMIC_DELIVERY_FAILURE'].includes(policy.reason??'')&&!paused&&capabilities&&observed,
  canEnable:!!policy&&policy.state==='CLOSED'&&policy.reason==='OPERATOR_DISABLED'&&!paused&&capabilities,
  canDisable:policy?.state==='ACTIVE'||recovering,expected:policy?`${policy.id}:${policy.state}`:'',
  reason:!policy?'NO_AUTHORIZATION':paused?'EMERGENCY_HOLD':!fresh?'PUBLISHER_UNAVAILABLE':heartbeat?.lastError?'PUBLISHER_ERROR':m.autoPublish!==true?'AUTO_CAPABILITY_OFF':m.shadowMode!==false?'SHADOW_MODE_BLOCKED':m.requireApproval!==true?'APPROVAL_CAPABILITY_MISMATCH':m.externalPublishingEnabled!==true?'TELEGRAM_DELIVERY_OFF':m.destination!==policy.destination?'DESTINATION_MISMATCH':!observed?'AWAITING_PUBLISHER':recovering?policy.recovery!.blocker:policy.state==='ACTIVE'?'ENABLED':policy.reason==='OPERATOR_DISABLED'?'DISABLED':policy.reason??'DISABLED'};
}
