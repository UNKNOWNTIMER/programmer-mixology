import { createContext, useContext, useMemo, Children, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import messages from './i18n-messages.json';
export type Language='zh'|'en';
const Context=createContext<Language>('zh');
const dictionary=messages as Record<string,string>;
const cache=new Map<string,string>();
const fragments:Record<string,string[]>={};
for(const key of Object.keys(dictionary).filter(key=>key.length>1).sort((a,b)=>b.length-a.length))(fragments[key[0]]??=[]).push(key);
/** Translate explicit UI text only. Stored recipes, account names and snapshots are never rewritten. */
export function translate(source:string,language:Language):string {
  if(language==='zh'||!/[\u3400-\u9fff]/.test(source))return source;
  const cached=cache.get(source);if(cached!==undefined)return cached;
  const text=source.trim(),direct=dictionary[text];
  if(direct!==undefined)return source.replace(text,direct);
  // Dynamic UI sentences consist of translated fixed fragments plus IDs, counts or paths.
  // Only known phrases are matched; arbitrary imported prose remains in its original language.
  let result='',position=0;
  while(position<source.length){let matched=false;for(const key of fragments[source[position]]||[]){if(source.startsWith(key,position)){result+=dictionary[key];position+=key.length;matched=true;break;}}if(!matched)result+=source[position++];}
  if(cache.size>2048)cache.clear();cache.set(source,result);return result;
}
export function I18nProvider({language,children}:{language:Language;children:ReactNode}){return <Context.Provider value={language}>{children}</Context.Provider>;}
export function useI18n(){const language=useContext(Context);return useMemo(()=>({language,t:(source:string)=>translate(source,language)}),[language]);}
function renderText(node:ReactNode,language:Language):ReactNode {
  if(typeof node==='string')return translate(node,language);
  if(!isValidElement(node))return node;
  const element=node as ReactElement<Record<string,unknown>>,props=element.props;
  if(props['data-i18n']==='verbatim'||element.type==='pre'||element.type==='code')return node;
  const next:Record<string,unknown>={};
  if(typeof element.type==='string')for(const key of ['title','aria-label','aria-valuetext','placeholder','alt'])if(typeof props[key]==='string')next[key]=translate(props[key] as string,language);
  // React components own their text; keep their business props unchanged. Children are display content.
  if(props.children!==undefined)next.children=Children.map(props.children as ReactNode,child=>renderText(child,language));
  return cloneElement(element,next);
}
/** Pure React text boundary. This never queries/mutates DOM, input values, handlers or business keys. */
export function Localized({children}:{children:ReactNode}){const language=useContext(Context);return <>{Children.map(children,child=>renderText(child,language))}</>;}
