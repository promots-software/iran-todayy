import {z} from 'zod';
const text=z.string().min(1).max(20000);
export const eventIdentitySchema=z.object({
 basis:z.enum(['SAME_OCCURRENCE','DIFFERENT_OCCURRENCE','TOPIC_ONLY','UNRESOLVED']),
 incomingFactIds:z.array(text).min(1),existingFactIds:z.array(text).min(1),explanation:text,
}).strict();
export const eventIdentityInstructions='Compare concrete event/statement occurrence, not topic similarity. SAME needs an explicit SAME_OCCURRENCE identity explanation supported by incomingFactIds and existingFactIds. A new meeting, interview, speech, announcement, date or occasion is not the same event merely because actor/topic/wording overlaps. TOPIC_ONLY and DIFFERENT_OCCURRENCE mean DIFFERENT; insufficient occasion evidence means UNCERTAIN. Source-grounded FACT and CLAIM can be material new developments; verified=false means no independent real-world truth verification, not absence of validated textual evidence. Include ALL new material fact IDs, including new attributed assertions/conditions; an empty list must mean no new material meaning.';
