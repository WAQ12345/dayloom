/** Preserve the clipboard Markdown exactly; validation happens before changing the editor. */
export function appendIdeaClipboard(body:string,clipboard:string):string{
 if(!clipboard.trim())throw new Error('剪贴板没有文字');
 const next=body?`${body}\n\n${clipboard}`:clipboard;
 if(Array.from(next).length>20000)throw new Error('粘贴后正文超过20000个字');
 if(next.includes('\u0000'))throw new Error('剪贴板包含无效字符');
 return next;
}
