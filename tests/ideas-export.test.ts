import test from 'node:test';
import assert from 'node:assert/strict';
import { ideasDocument, renderHtml, renderMarkdown } from '../src/services/export/document.ts';
import type { Idea } from '../src/domain/ideas.ts';
const first:Idea={id:'a',body:'多行想法\n第二行：💡 <script>敏感标签</script>\n## 原文标题',tags:['生活','写作'],pinned:false,archived:false,createdAt:1792036800000,updatedAt:1792036800000};
test('ideas export freezes full body, tags, writing order and changed time without invented titles',()=>{
 const updated={...first,id:'b',body:'较新想法',createdAt:first.createdAt+1000,updatedAt:first.createdAt+2000};
 const doc=ideasDocument([first,updated],new Date('2026-10-15T12:00:00Z'));
 const md=renderMarkdown(doc),html=renderHtml(doc);
 assert.equal(doc.kind,'ideas');assert.equal(doc.count,2);assert.ok(md.indexOf('较新想法')<md.indexOf('多行想法'));assert.match(md,/1 · 编写/);assert.match(md,/2 · 编写/);assert.match(md,/修改/);assert.match(md,/生活/);assert.match(md,/第二行/);assert.match(md,/💡/);assert.equal(doc.blocks.filter(b=>b.kind==='heading').length,2);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
 first.body='修改后的正文';first.tags.push('后来');updated.body='后来编辑';
 assert.equal(renderMarkdown(doc),md);assert.equal(renderHtml(doc),html);
});
test('ideas export rejects empty selection and retains long content beyond page breaks',()=>{
 assert.throws(()=>ideasDocument([]));const body=Array.from({length:220},(_,i)=>`第${i+1}行，长文本自然分页。`).join('\n');const doc=ideasDocument([{...first,body}]);assert.ok(renderMarkdown(doc).includes('第220行'));assert.ok(renderHtml(doc).includes('第220行'));
});

test('ideas preserve Markdown body line breaks, blank lines and list syntax, while PDF HTML escapes original content',()=>{
 const body='  缩进开头\n\n1. 第一条\n2. 第二条\n\n- 无序列表\n- **原文强调**\n\n<标签> & <script>不可执行</script>\n';
 const doc=ideasDocument([{...first,body,tags:[],createdAt:1,updatedAt:1}]);
 const markdown=renderMarkdown(doc),html=renderHtml(doc);
 assert.ok(markdown.includes(body));assert.ok(!markdown.includes('<br>'));assert.ok(html.includes('class="idea-body"'));assert.ok(html.includes('white-space:pre-wrap'));assert.ok(html.includes('&lt;标签&gt;'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('  缩进开头\n\n1. 第一条'));
});
test('ideas export uses the repository id-desc tie-break for equal writing times',()=>{
 const doc=ideasDocument([{...first,id:'a',body:'排序甲',createdAt:1,updatedAt:1},{...first,id:'z',body:'排序乙',createdAt:1,updatedAt:1}]);
 assert.ok(renderMarkdown(doc).indexOf('排序乙')<renderMarkdown(doc).indexOf('排序甲'));
});
