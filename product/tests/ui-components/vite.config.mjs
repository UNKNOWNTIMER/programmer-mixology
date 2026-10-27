import { defineConfig } from '../../apps/client/node_modules/vite/dist/node/index.js';
import react from '../../apps/client/node_modules/@vitejs/plugin-react/dist/index.js';
import { fileURLToPath } from 'node:url';
const path=(value)=>fileURLToPath(new URL(value,import.meta.url));
export default defineConfig({root:path('./'),plugins:[react()],resolve:{alias:{react:path('../../apps/client/node_modules/react'),'react-dom':path('../../apps/client/node_modules/react-dom')}},server:{host:'127.0.0.1',port:1422,strictPort:true,fs:{allow:[path('../../')]}}});
