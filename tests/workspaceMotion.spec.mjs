/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/client/motion.js.txt',import.meta.url),'utf8').split('})();\n(function(){')[0]+'})();';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness({reduce=false,initialDialogs=[]}={}){
  const window={matchMedia:()=>({matches:reduce}),addEventListener(){}};
  const document={querySelectorAll:selector=>selector==='dialog'?initialDialogs:[],querySelector:()=>null,addEventListener(){}};
  runInNewContext(source,{window,document,WeakMap,Map,Promise,Array,Math,setTimeout,requestAnimationFrame:callback=>queueMicrotask(callback),cancelAnimationFrame(){},getComputedStyle:e=>({transform:e.base||'none',opacity:'1',display:'block'})});
  return window.WorkspaceMotion;
}
function element(){
  const classes=new Set(),attributes=new Map(),listeners={};
  const e={open:false,hidden:false,disabled:false,dataset:{},animations:[],listeners,openCalls:0,closeCalls:0,
    classList:{add:(...items)=>items.forEach(i=>classes.add(i)),remove:(...items)=>items.forEach(i=>classes.delete(i)),contains:i=>classes.has(i)},
    getAttribute:key=>attributes.get(key)??null,setAttribute:(key,value)=>attributes.set(key,String(value)),removeAttribute:key=>attributes.delete(key),
    addEventListener:(type,callback)=>listeners[type]=callback,
    showModal(){this.open=true;this.openCalls++},close(value){this.open=false;this.closeCalls++;this.returnValue=value},
    animate(frames,options){let finish,reject;const animation={frames,options,finished:new Promise((a,b)=>{finish=a;reject=b}),finish:()=>finish(),cancel:()=>reject(new Error('cancelled'))};this.animations.push(animation);return animation}
  };return e;
}
test('弹窗打开保留原生模态行为，动画结束后保持打开',async()=>{
  const m=harness(),d=element();m.open(d);assert.equal(d.openCalls,1);assert.equal(d.open,true);assert.equal(d.animations[0].options.duration,240);d.animations[0].finish();await settle();assert.equal(d.open,true);assert.equal(d.classList.contains('motion-opening'),false);
});
test('关闭只在退场结束时执行，重复关闭不会执行两次',async()=>{
  const m=harness(),d=element();d.open=true;const first=m.close(d,'cancel'),second=m.close(d,'cancel');assert.equal(first,second);assert.equal(d.open,true);assert.equal(d.closeCalls,0);d.animations.at(-1).finish();await first;assert.equal(d.closeCalls,1);assert.equal(d.returnValue,'cancel');
});
test('快速重新打开取消旧退场回调，不会把新弹窗误关',async()=>{
  const m=harness(),d=element();d.open=true;const pending=m.close(d);m.open(d);await pending;assert.equal(d.closeCalls,0);assert.equal(d.open,true);d.animations.at(-1).finish();await settle();assert.equal(d.open,true);
});
test('减少动态效果偏好下，弹窗和提示都即时完成',async()=>{
  const m=harness({reduce:true}),d=element();m.open(d);await m.close(d);assert.equal(d.open,false);assert.equal(d.animations.length,0);m.show(d);assert.equal(d.hidden,false);await m.hide(d);assert.equal(d.hidden,true);assert.equal(d.animations.length,0);
});
test('提示进出场保留原有水平居中变换，不会飞到屏幕边缘',async()=>{
  const m=harness(),toast=element();toast.base='matrix(1, 0, 0, 1, -200, 0)';m.show(toast);assert.ok(toast.animations[0].frames[0].transform.startsWith(toast.base));assert.equal(toast.animations[0].frames[1].transform,toast.base);const hiding=m.hide(toast);toast.animations.at(-1).finish();await hiding;assert.equal(toast.hidden,true);
});
test('提交时拦住重复点击，结束后恢复原有可用状态和辅助属性',async()=>{
  const m=harness(),button=element();let calls=0,release;const gate=new Promise(resolve=>release=resolve);const first=m.task(button,async()=>{calls++;await gate});await settle();assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');await m.task(button,()=>calls++);assert.equal(calls,1);release();await first;assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.classList.contains('motion-busy'),false);
});
test('操作失败也释放忙碌状态，不把按钮永久锁住',async()=>{
  const m=harness({reduce:true}),button=element();await assert.rejects(m.task(button,()=>{throw new Error('failed')}),/failed/);assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);
});
test('Escape关闭走退场动作，不提交表单或触发必填校验',async()=>{
  const d=element();d.open=true;const m=harness({initialDialogs:[d]});let prevented=false;d.listeners.cancel({preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(d.closeCalls,0);d.animations.at(-1).finish();await settle();assert.equal(d.closeCalls,1);assert.equal(d.open,false);assert.ok(m);
});
