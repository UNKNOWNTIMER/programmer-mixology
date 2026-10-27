import { I18nProvider, Localized } from './i18n';
import { normalizeLanguage } from './language';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { RecipePopupWindow } from './RecipeWindow';
import { GlassPopupWindow } from './GlassCallout';
import { TastePopupWindow } from './TastePie';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './styles.css';
import './workbench.css';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}> {
  state={error:''};
  static getDerivedStateFromError(error:Error){return {error:error.message};}
  componentDidCatch(){if('__TAURI_INTERNALS__' in window)void getCurrentWindow().show();}
  render(){return this.state.error?<I18nProvider language={normalizeLanguage(localStorage.getItem('timer.language'))}><Localized><div className="fatal"><h1>工作台出现错误</h1><p>已保存的本机数据不会被自动清除。</p><pre>{this.state.error}</pre><button onClick={()=>location.reload()}>重新打开</button></div></Localized></I18nProvider>:this.props.children;}
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary>{new URLSearchParams(location.search).get('view')==='recipe'?<RecipePopupWindow/>:new URLSearchParams(location.search).get('view')==='glass'?<GlassPopupWindow/>:new URLSearchParams(location.search).get('view')==='taste'?<TastePopupWindow/>:<App/>}</ErrorBoundary></React.StrictMode>);
