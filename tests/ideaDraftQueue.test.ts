import test from 'node:test';
import assert from 'node:assert/strict';
import { IdeaDraftQueue } from '../src/features/ideaDraftQueue.ts';
function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
test('unmount generation skips old queued drafts before a later restore or module deletion',async()=>{
 const queue=new IdeaDraftQueue(),gate=deferred(),started=deferred();const writes:string[]=[];
 void queue.enqueue(async()=>{started.release();await gate.promise;writes.push('started-before-navigation');});
 await started.promise;
 void queue.enqueue(async()=>{writes.push('obsolete-last-input');});
 queue.cancelPending();gate.release();await queue.flush();
 // The already-started DB write is ordered before the later restore/delete transaction.
 writes.push('restore-or-delete');
 assert.deepEqual(writes,['started-before-navigation','restore-or-delete']);
 await queue.enqueue(async()=>{writes.push('new-generation');});
 assert.equal(writes.at(-1),'new-generation');
});
test('normal close and save flush all accepted draft writes before consuming the draft',async()=>{
 const queue=new IdeaDraftQueue(),gate=deferred();const writes:string[]=[];
 void queue.enqueue(async()=>{await gate.promise;writes.push('first');});
 void queue.enqueue(async()=>{writes.push('latest');});
 const save=queue.flush().then(()=>{writes.push('consume-draft-in-record-transaction');});
 gate.release();await save;
 assert.deepEqual(writes,['first','latest','consume-draft-in-record-transaction']);
});
test('a failed draft does not block a later edit while flush still reports the current failure',async()=>{
 const queue=new IdeaDraftQueue();const failure=queue.enqueue(async()=>{throw new Error('disk failure');});
 await assert.rejects(failure,/disk failure/);await assert.rejects(queue.flush(),/disk failure/);
 let saved=false;await queue.enqueue(async()=>{saved=true;});await queue.flush();assert.ok(saved);
});
