import {autoPolicySchema} from './auto-policy';

type Heartbeat={lastSeenAt:Date;lastError:string|null;metadata:unknown}|null|undefined;
export function automaticControlState(raw:unknown,paused:boolean,heartbeat:Heartbeat,now=new Date()){
 const parsed=autoPolicySchema.safeParse(raw),policy=parsed.success?parsed.data:null;
 const m=heartbeat?.metadata&&typeof heartbeat.metadata==='object'?heartbeat.metadata as Record<string,unknown>:{};
 const fresh=!!heartbeat&&now.getTime()-heartbeat.lastSeenAt.getTime()<45000&&now.getTime()>=heartbeat.lastSeenAt.getTime();
 const capabilities=fresh&&!heartbeat?.lastError&&m.autoPublish===true&&m.shadowMode===false&&m.requireApproval===true&&m.externalPublishingEnabled===true&&!!policy&&m.destination===policy.destination;
 const observed=!!policy&&m.policyId===policy.id&&m.policyState===policy.state;
 const enabled=!!policy&&policy.state==='ACTIVE'&&!paused&&capabilities&&observed;
 return {policy,fresh,capabilities,observed,enabled,shadowMode:m.shadowMode,deliveryEnabled:m.externalPublishingEnabled,
  canAcknowledge:!!policy&&policy.state==='CLOSED'&&policy.reason==='DELIVERY_PERSISTENCE_OR_SAFETY_FAILURE'&&!paused&&capabilities&&observed,
  canEnable:!!policy&&policy.state==='CLOSED'&&policy.reason==='OPERATOR_DISABLED'&&!paused&&capabilities,
  canDisable:policy?.state==='ACTIVE',expected:policy?`${policy.id}:${policy.state}`:'',
  reason:!policy?'NO_AUTHORIZATION':paused?'EMERGENCY_HOLD':!fresh?'PUBLISHER_UNAVAILABLE':!capabilities?'DELIVERY_BLOCKED':!observed?'AWAITING_PUBLISHER':policy.state==='ACTIVE'?'ENABLED':'DISABLED'};
}
