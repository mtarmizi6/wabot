import test from 'node:test';
import assert from 'node:assert/strict';
import {helpMessage,helpTopicMessage,routeTelegramUpdate,formatTelegramMessage} from '../src/telegram/controller.js';
const route=text=>routeTelegramUpdate({message:{from:{id:123},chat:{id:123,type:'private'},text}},'123');
test('Help 197: every linked topic routes, renders and returns to help without inline controls',()=>{
 for(const topic of ['whatsapp','join','group','posting','client','group-status','manage','records','report','system','problem']){
  const action='help_'+topic.replaceAll('-','_');
  assert.equal(route('.help '+topic).action,action);
  assert.equal(route('/help '+topic).action,action);
  const text=helpTopicMessage(action),html=formatTelegramMessage(text);
  assert.ok(text.length<3800,topic);assert.match(text,/\.help →/);assert.match(html,/<b>/);assert.match(html,/<code>\.help<\/code>/);
  for(const command of text.matchAll(/↳ (\.[a-z-]+) →/g))assert.notEqual(route(command[1]).action,'text',command[1]);
 }
 assert.match(helpMessage(),/\.help group-status/);assert.equal(helpTopicMessage('missing'),helpMessage());
});
