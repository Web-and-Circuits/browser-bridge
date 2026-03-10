/**
 * bookmarklet.js — browser-bridge bookmarklet (readable source)
 *
 * Copy the minified one-liner from the bottom of this file into a
 * browser bookmark. Click the bookmark on any page to connect it
 * to the local bridge server (node server.js).
 *
 * Requires: server.js running locally (node server.js)
 *
 * Re-clicking the bookmark reconnects if the socket dropped.
 */

// ─── Source (readable) ────────────────────────────────────────────────────

(function () {
  const PORT = 9876;

  if (window.__bb) {
    // Re-click reconnects
    try { window.__bb.ws.close(); } catch {}
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function visibleText(root, max = 10000) {
    const t = (root?.innerText || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '\u2026' : t;
  }

  function links(root) {
    return Array.from(root.querySelectorAll('a[href]')).slice(0, 100)
      .map(a => ({ text: (a.innerText || '').trim(), href: a.href }))
      .filter(l => l.href);
  }

  function forms(root) {
    return Array.from(root.querySelectorAll('input,textarea,select,button')).map(el => ({
      tag:         el.tagName.toLowerCase(),
      type:        el.type || null,
      name:        el.name || null,
      id:          el.id   || null,
      placeholder: el.placeholder || null,
      value:       el.value || null,
      label:       el.labels?.[0]?.textContent?.trim() || null,
      selector:    el.id ? '#' + el.id : el.name ? '[name="' + el.name + '"]' : el.tagName.toLowerCase()
    }));
  }

  // ── Request handler ───────────────────────────────────────────────────────

  async function handle(req) {
    const { id, action, args = {} } = req;
    const root = args.selector
      ? (document.querySelector(args.selector) || document.body)
      : document.body;

    try {
      if (action === 'ping') {
        return { id, ok: true, result: { pong: true } };
      }

      if (action === 'get_active_tab') {
        return { id, ok: true, result: { tabId: null, title: document.title, url: location.href } };
      }

      if (action === 'snapshot') {
        const mode   = args.mode || 'default';
        const result = { title: document.title, url: location.href, selectionText: String(window.getSelection()) };
        if (mode === 'forms') result.forms = forms(root);
        else { result.visibleText = visibleText(root); result.links = links(root); }
        return { id, ok: true, result };
      }

      if (action === 'run_js') {
        const value = eval(args.code); // jshint ignore:line
        return { id, ok: true, result: value };
      }

      if (action === 'click') {
        const el = document.querySelector(args.selector);
        if (!el) throw new Error('No element: ' + args.selector);
        el.click();
        return { id, ok: true, result: { clicked: args.selector } };
      }

      if (action === 'fill') {
        const el = document.querySelector(args.selector);
        if (!el) throw new Error('No element: ' + args.selector);
        const setter =
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,   'value')?.set ||
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(el, args.value); else el.value = args.value;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { id, ok: true, result: { filled: args.selector } };
      }

      if (action === 'navigate') {
        location.href = args.url;
        return { id, ok: true, result: { url: args.url } };
      }

      return { id, ok: false, error: { message: 'Unsupported action' } };
    } catch (e) {
      return { id, ok: false, error: { message: e.message } };
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  function connect() {
    const ws = new WebSocket('ws://localhost:' + PORT);

    ws.onopen    = () => console.log('[bridge] connected to ws://localhost:' + PORT);
    ws.onclose   = () => { console.log('[bridge] disconnected — retrying…'); setTimeout(connect, 3000); };
    ws.onerror   = () => {};
    ws.onmessage = async e => {
      const req = JSON.parse(e.data);
      const res = await handle(req);
      res.createdAt = new Date().toISOString();
      ws.send(JSON.stringify(res));
    };

    window.__bb = { ws, PORT };
  }

  connect();
  console.log('[bridge] bookmarklet loaded — connecting to ws://localhost:' + PORT);
})();

// ─── Minified bookmarklet (paste into bookmark URL field) ─────────────────
//
// javascript:(function(){const PORT=9876;if(window.__bb){try{window.__bb.ws.close()}catch{}}function V(r,m=10000){const t=(r?.innerText||'').replace(/\s+/g,' ').trim();return t.length>m?t.slice(0,m)+'\u2026':t}function L(r){return Array.from(r.querySelectorAll('a[href]')).slice(0,100).map(a=>({text:(a.innerText||'').trim(),href:a.href})).filter(l=>l.href)}function F(r){return Array.from(r.querySelectorAll('input,textarea,select,button')).map(el=>({tag:el.tagName.toLowerCase(),type:el.type||null,name:el.name||null,id:el.id||null,placeholder:el.placeholder||null,value:el.value||null,label:el.labels?.[0]?.textContent?.trim()||null,selector:el.id?'#'+el.id:el.name?'[name="'+el.name+'"]':el.tagName.toLowerCase()}))}async function H(req){const{id,action,args={}}=req;const root=args.selector?(document.querySelector(args.selector)||document.body):document.body;try{if(action==='ping')return{id,ok:true,result:{pong:true}};if(action==='get_active_tab')return{id,ok:true,result:{tabId:null,title:document.title,url:location.href}};if(action==='snapshot'){const mode=args.mode||'default';const result={title:document.title,url:location.href,selectionText:String(window.getSelection())};if(mode==='forms')result.forms=F(root);else{result.visibleText=V(root);result.links=L(root)}return{id,ok:true,result}}if(action==='run_js'){const value=eval(args.code);return{id,ok:true,result:value}}if(action==='click'){const el=document.querySelector(args.selector);if(!el)throw new Error('No element: '+args.selector);el.click();return{id,ok:true,result:{clicked:args.selector}}}if(action==='fill'){const el=document.querySelector(args.selector);if(!el)throw new Error('No element: '+args.selector);const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set||Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;if(s)s.call(el,args.value);else el.value=args.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return{id,ok:true,result:{filled:args.selector}}}if(action==='navigate'){location.href=args.url;return{id,ok:true,result:{url:args.url}}}return{id,ok:false,error:{message:'Unsupported action'}}}catch(e){return{id,ok:false,error:{message:e.message}}}}function connect(){const ws=new WebSocket('ws://localhost:'+PORT);ws.onopen=()=>console.log('[bridge] connected');ws.onclose=()=>{setTimeout(connect,3000)};ws.onerror=()=>{};ws.onmessage=async e=>{const req=JSON.parse(e.data);const res=await H(req);res.createdAt=new Date().toISOString();ws.send(JSON.stringify(res))};window.__bb={ws,PORT}}connect()})();
