import {describe,it,expect} from 'vitest';
import manifest from '../../../data/dlc/xiaodong/catalog.json';
import editorial from '../../../data/dlc/xiaodong/editorial.json';
import type {Recipe} from './types';
import {notebookDetails,notebookQuote} from './dlc-notebook';

describe('self-contained DLC notebook',()=>{
  it('preserves all 96 original quotations and tasting notes through archive copy identities',()=>{
    const quotes=new Set<string>();
    for(const recipe of manifest.recipes as Recipe[]){
      const source=editorial[recipe.id as keyof typeof editorial];
      const copy={...recipe,id:'personal_test_copy',prediction_profile_id:'personal_test_copy',source:{...recipe.source,kind:'imported_snapshot'}};
      const notes=notebookDetails(copy)!;
      expect(notes).toBeDefined();expect(notes.quote).toBe(source.source_quote_zh);
      expect(notes.experiences).toEqual(source.source_record.experience_or_history_source);
      expect(notes.stories).toEqual(source.source_literary_background_zh);
      expect(notes.workingNotes.length).toBeGreaterThan(0);quotes.add(notes.quote!);
    }
    expect(quotes.size).toBe(96);
  });
  it('does not restore removed or edited notes or attach a reused ID to a changed recipe',()=>{
    const recipe=manifest.recipes[0] as Recipe;
    expect(notebookQuote({...recipe,notes_zh:'My own new notes'})).toBeUndefined();
    expect(notebookQuote({...recipe,steps_zh:['A different drink']})).toBeUndefined();
    const changed={...recipe,notes_zh:recipe.notes_zh.replace(notebookQuote(recipe)!,'自己的新酒语')};
    expect(notebookQuote(changed)).toBe('自己的新酒语');
    expect(notebookDetails({...recipe,notes_zh:recipe.notes_zh+'\n我的新笔记'} )?.extraNotes).toContain('我的新笔记');
  });
});
