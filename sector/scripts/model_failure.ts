import {errorCode} from '../src/pipeline';
export type ModelStage='lease'|'generate'|'decode'|'review'|'render'|'submit'|'delivery';
// Keep domain failures unchanged; never persist arbitrary exception messages or secrets.
export function modelFailureCode(error:unknown,stage:ModelStage):string{
 const code=errorCode(error);return code==='operation_failed'?`model_${stage}_failed`:code;
}
