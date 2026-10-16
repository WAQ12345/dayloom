import test from 'node:test';
import assert from 'node:assert/strict';
import { appendIdeaClipboard } from '../src/features/ideaPaste.ts';
test('explicit paste preserves Markdown and appends one blank line',()=>{const clip='  ## 标题\n\n- **列表**\n- 💡\n';assert.equal(appendIdeaClipboard('',clip),clip);assert.equal(appendIdeaClipboard('原文',clip),'原文\n\n'+clip);});
test('empty, invalid and oversized clipboard never produce a replacement body',()=>{assert.throws(()=>appendIdeaClipboard('原文',' \n'));assert.throws(()=>appendIdeaClipboard('原文','\u0000'));assert.throws(()=>appendIdeaClipboard('原文','字'.repeat(20000)));assert.equal(Array.from(appendIdeaClipboard('','💡'.repeat(20000))).length,20000);});
