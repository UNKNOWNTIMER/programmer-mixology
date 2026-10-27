import type { Recipe } from './types';
import { dlcRecipeId } from './dlc-art';

/** Read only the self-contained notes carried by the recipe/archive. The art
 * signature prevents a reused ID from attaching another drink's notebook. */
export function notebookDetails(recipe:Recipe) {
  if(!dlcRecipeId(recipe)||!recipe.notes_zh.startsWith('小董调酒笔记 DLC｜'))return undefined;
  const lines=recipe.notes_zh.split('\n').filter(Boolean);
  const value=(prefix:string)=>lines.filter(line=>line.startsWith(prefix)).map(line=>line.slice(prefix.length));
  return {
    quote:lines.find(line=>line.startsWith('原始类别：'))?.split('。酒语：')[1],
    experiences:value('原笔记体验／背景：'),
    stories:value('原文文学背景：'),
    workingNotes:value('本次编辑补全：'),
    sourceNotes:lines.filter(line=>line.startsWith('源配料文字：')||line.startsWith('原整理疑项：')),
    extraNotes:lines.filter(line=>!['小董调酒笔记 DLC｜','原始类别：','原笔记体验／背景：','原文文学背景：','本次编辑补全：','源配料文字：','原整理疑项：','来源：','原文星号不是实饮评分；预测为未验证编辑推断'].some(prefix=>line.startsWith(prefix))),
  };
}

// Keep the author's supplied Chinese wording in both interface languages rather
// than presenting a new translation as the author's original quotation.
export const notebookQuote=(recipe:Recipe)=>notebookDetails(recipe)?.quote;
