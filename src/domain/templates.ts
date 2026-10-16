export type TaskTemplate={id:string;name:string;note:string;orderLevel:1|2|3;createdAt:number;updatedAt:number};
export type TemplateInput=Pick<TaskTemplate,'name'|'note'|'orderLevel'>;
/** Same UTF-16 bounds as task records, so every valid template can generate a valid task. */
export function validateTemplate(value:unknown):TemplateInput {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('模板格式无效');
 const v=value as Record<string,unknown>;
 if(typeof v.name!=='string'||!v.name.trim()||v.name.trim().length>100)throw new Error('模板名称需为1—100个字');
 if(typeof v.note!=='string'||v.note.length>500||/\u0000/.test(v.note))throw new Error('模板备注最多500个字');
 if(![1,2,3].includes(v.orderLevel as number))throw new Error('请选择模板次序');
 return{name:v.name.trim(),note:v.note,orderLevel:v.orderLevel as 1|2|3};
}
