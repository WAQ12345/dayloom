import type {Idea} from '../domain/ideas.ts';
export const DEFAULT_IDEA_QUESTION='请整理这些想法，保留原意，并指出需要补充的问题';
export function ideaQuestion(value:string):string{return value.trim()||DEFAULT_IDEA_QUESTION;}
/** Resolve exactly the selected IDs in one repository read; never silently omit missing source. */
export async function loadSelectedIdeas(ids:readonly string[],read:(ids:readonly string[])=>Promise<Idea[]>):Promise<Idea[]>{
 if(!ids.length)throw new Error('请至少选择一条想法');
 if(new Set(ids).size!==ids.length)throw new Error('想法选择重复，请重新选择');
 const ideas=await read(ids);
 if(ideas.length!==ids.length||ideas.some((idea,index)=>idea.id!==ids[index]))throw new Error('所选想法已改变，请重新选择资料');
 return ideas;
}
