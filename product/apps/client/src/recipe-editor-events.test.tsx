import { describe,expect,it,vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
const hooks=vi.hoisted(()=>({values:[] as unknown[],index:0}));
vi.mock('react',async original=>{const actual=await original<typeof import('react')>();return {...actual,useState:<T,>(initial:T|(()=>T))=>{const index=hooks.index++;if(!(index in hooks.values))hooks.values[index]=typeof initial==='function'?(initial as ()=>T)():initial;return [hooks.values[index],(next:T|((current:T)=>T))=>{hooks.values[index]=typeof next==='function'?(next as (current:T)=>T)(hooks.values[index] as T):next;}];},useRef:<T,>(initial:T)=>{const index=hooks.index++;if(!(index in hooks.values))hooks.values[index]={current:initial};return hooks.values[index];}};});
vi.mock('./i18n',()=>({Localized:({children}:{children:ReactNode})=>children,useI18n:()=>({language:'zh',t:(text:string)=>text})}));
import { RecipeEditor, type RecipeEditorProps } from './RecipeEditor';
import { blankRecipeDraft, emptyRecipeIngredient } from './recipe-editor-state';
import type { Ingredient } from './types';
type Element=ReactElement<Record<string,unknown>>;
function all(node:ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(all);if(!node||typeof node!=='object'||!('props'in node))return [];const element=node as Element;return [element,...all(element.props.children as ReactNode)];}
function harness(save:RecipeEditorProps['onSave']){
 hooks.values=[];const cancel=vi.fn(),initial={...blankRecipeDraft(),name_en:'Private Cup',ingredients:[{...emptyRecipeIngredient(),ingredient_id:'gin',quantity:30}],steps_zh:['Stir.']};
 const props:RecipeEditorProps={ingredients:[{id:'gin',name_zh:'金酒',name_en:'Gin'} as Ingredient],initial,initialTarget:{taste_bps:[5000,2000,1000,1000,1000],sensory_0_10:[0,1,2,3,4,5,6]},onSave:save,onCancel:cancel};
 const render=()=>{hooks.index=0;return all(RecipeEditor(props));};const find=(predicate:(element:Element)=>boolean)=>{const result=render().find(predicate);if(!result)throw Error('Element missing');return result;};
 return {cancel,props,render,submit:()=>{const form=find(e=>e.type==='form');(form.props.onSubmit as (e:unknown)=>void)({preventDefault:vi.fn()});},changeName:(name:string)=>{const input=find(e=>e.props['aria-label']==='英文酒名');(input.props.onChange as (e:unknown)=>void)({target:{value:name}});},cancelClick:()=>{const button=find(e=>e.type==='button'&&e.props.children==='取消');(button.props.onClick as ()=>void)();},pending:()=>find(e=>e.type==='button'&&e.props.type==='submit').props.disabled};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
describe('actual recipe editor save and cancel handlers',()=>{
 it('sends one defensive snapshot while save is pending and blocks cancellation and repeat submits',async()=>{
   let resolve!:()=>void;const save=vi.fn<RecipeEditorProps['onSave']>(()=>new Promise<void>(done=>{resolve=done;})),h=harness(save);h.submit();h.submit();h.cancelClick();expect(save).toHaveBeenCalledTimes(1);expect(h.cancel).not.toHaveBeenCalled();expect(h.pending()).toBe(true);expect(save.mock.calls[0][0]).not.toBe(h.props.initial);resolve();await flush();expect(h.pending()).toBe(false);
 });
 it('retains edited fields after save failure and permits an explicit retry',async()=>{
   const save=vi.fn<RecipeEditorProps['onSave']>().mockRejectedValueOnce(Error('Disk unavailable')).mockResolvedValueOnce(undefined),h=harness(save);h.changeName('My edited cup');h.submit();await flush();expect(h.pending()).toBe(false);expect(h.render().some(e=>e.props['aria-label']==='英文酒名'&&e.props.value==='My edited cup')).toBe(true);expect(h.render().some(e=>e.props.children==='Disk unavailable')).toBe(true);h.submit();await flush();expect(save).toHaveBeenCalledTimes(2);expect(save.mock.calls[1][0].name_en).toBe('My edited cup');
 });
 it('cancels without writing and blocks invalid drafts before invoking persistence',()=>{
   const save=vi.fn<RecipeEditorProps['onSave']>().mockResolvedValue(undefined),h=harness(save);h.cancelClick();expect(h.cancel).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();h.changeName('  ');h.submit();expect(save).not.toHaveBeenCalled();expect(h.render().some(e=>e.props.role==='alert')).toBe(true);
 });
 it('does not adopt a supplied target until Use current taste is clicked',()=>{
   const save=vi.fn<RecipeEditorProps['onSave']>().mockResolvedValue(undefined),h=harness(save);h.props.initial=undefined;
   expect(h.render().find(e=>e.props['aria-label']==='甜 配方预测')?.props.value).toBe(20);
   const button=h.render().find(e=>e.type==='button'&&e.props.children==='使用当前味觉');expect(button).toBeDefined();(button!.props.onClick as ()=>void)();
   expect(h.render().find(e=>e.props['aria-label']==='甜 配方预测')?.props.value).toBe(50);expect(save).not.toHaveBeenCalled();
 });
});
