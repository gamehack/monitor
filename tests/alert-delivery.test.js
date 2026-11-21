import test from 'node:test';
import assert from 'node:assert/strict';
import {feishuReceipt} from '../src/alert-delivery.js';

test('Feishu 200 with code 0 is acknowledged',()=>{
 assert.equal(feishuReceipt(200,{code:0}).accepted,true);
 assert.equal(feishuReceipt(200,{StatusCode:0}).accepted,true);
 assert.equal(feishuReceipt(200,{errcode:0}).accepted,true);
});
test('HTTP 200 is not enough when Feishu rejected it',()=>{
 assert.equal(feishuReceipt(200,{code:19021}).accepted,false);
 assert.equal(feishuReceipt(200,{code:19021}).retryable,true);
 assert.equal(feishuReceipt(200,{}).accepted,false);
});
test('auth errors are not immediately retryable',()=>{
 assert.equal(feishuReceipt(403,{code:19001}).retryable,false);
 assert.equal(feishuReceipt(429,{code:11232}).retryable,true);
});
