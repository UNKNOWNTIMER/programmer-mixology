import {createServer} from '../apps/client/node_modules/vite/dist/node/index.js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const product=resolve(dirname(fileURLToPath(import.meta.url)),'..'),client=resolve(product,'apps/client');
const out=resolve(process.env.PIXEL_ESTIMATE_AUDIT||resolve(product,'evidence/assisted-estimates'));
const server=await createServer({root:client,server:{middlewareMode:true},appType:'custom'});
try{
 const {estimateDisplayDrink}=await server.ssrLoadModule('/src/assisted-estimates.ts');
 const {estimateDrink}=await server.ssrLoadModule('/src/estimates.ts');
 const recipeBytes=await readFile(resolve(client,'public/seed/recipes.json')),ingredientBytes=await readFile(resolve(client,'public/seed/ingredients.json'));
 const recipes=JSON.parse(recipeBytes).recipes,ingredients=JSON.parse(ingredientBytes).ingredients;
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const before=JSON.stringify({recipes,ingredients});
 const rows=recipes.map(recipe=>({id:recipe.id,name:recipe.name_en,before:estimateDrink(recipe,ingredients),after:estimateDisplayDrink(recipe,ingredients)}));
 assert.equal(JSON.stringify({recipes,ingredients}),before);
 for(const {id,after}of rows)for(const key of ['servedVolumeMl','abvPercent','caloriesKcal'])assert(after[key]&&Number.isFinite(after[key].min)&&Number.isFinite(after[key].max),`${id}: ${key}`);
 const summary={recipes:rows.length,ingredientCount:ingredients.length,measured:false,localModelInvoked:false,method:'AI-assisted editorial assumptions, deterministic range calculation',
   before:{volume:rows.filter(r=>r.before.servedVolumeMl).length,abv:rows.filter(r=>r.before.abvPercent).length,kcal:rows.filter(r=>r.before.caloriesKcal).length},
   after:{volume:rows.filter(r=>r.after.servedVolumeMl).length,abv:rows.filter(r=>r.after.abvPercent).length,kcal:rows.filter(r=>r.after.caloriesKcal).length},
   recipeSha256:hash(recipeBytes),ingredientSha256:hash(ingredientBytes),sourceUnchanged:true};
 await mkdir(out,{recursive:true});await writeFile(resolve(out,'catalog-estimates.json'),JSON.stringify(rows,null,2));await writeFile(resolve(out,'estimate-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await server.close();}
