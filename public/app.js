
const API_BASE = window.location.origin;

    // Basic HTML escaping to safely inject text into innerHTML
    function escapeHtml(input){
      const s = (input === null || input === undefined) ? "" : String(input);
      return s.replace(/[&<>"']/g, (ch)=>({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#39;"
      }[ch]));
    }


    let COLORS = {};
    let INVENTORY = {};
    let LAST_SYNC = null;
    let CRITICAL_THRESHOLD = 300;
    let SORT_MODE = null; // null | 'asc' | 'desc'
    let PATTERN_CATEGORIES = [];
    let ACTIVE_PATTERN_CATEGORY_ID = null;
    let TODO_ACTIVE_CATEGORY_ID = null;
    const MAX_PATTERN_CATEGORIES = 10;

    // ====== View Mode (固定紧凑) ======
    let VIEW_MODE = "compact";
    document.body.dataset.view = VIEW_MODE;

    function bindSortAndViewToggles(){
      const btnAsc = document.getElementById("btnSortAsc");
      const btnDesc = document.getElementById("btnSortDesc");
      // --- sort mode ---
      const syncSortUI = ()=>{
        if(btnAsc) btnAsc.classList.toggle("active", SORT_MODE==="asc");
        if(btnDesc) btnDesc.classList.toggle("active", SORT_MODE==="desc");
      };
      const setSortMode = (mode)=>{
        SORT_MODE = mode; // null | 'asc' | 'desc'
        syncSortUI();
        try{ renderInventoryGrid(); }catch{}
      };
      if(btnAsc) btnAsc.addEventListener("click", ()=>{
        setSortMode(SORT_MODE==="asc" ? null : "asc");
      });
      if(btnDesc) btnDesc.addEventListener("click", ()=>{
        setSortMode(SORT_MODE==="desc" ? null : "desc");
      });
      syncSortUI();
    }

    // ====== App page navigation ======
    const APP_PAGE_KEY = "beads_app_page_v1";
    const SUBPAGE_PARENT = { consume: "records", restock: "records", "pattern-calc": "records", todo: "records" };

    function showPage(page, opts){
      const target = page || "inventory";
      document.querySelectorAll(".page").forEach(p=>{
        p.classList.toggle("active", p.dataset.page === target);
      });
      const activeTab = SUBPAGE_PARENT[target] || target;
      document.querySelectorAll(".tabbar-btn").forEach(btn=>{
        btn.classList.toggle("active", btn.dataset.tab === activeTab);
      });
      document.body.dataset.page = target;
      try{ localStorage.setItem(APP_PAGE_KEY, target); }catch{}
      if(opts && opts.scrollTop){
        window.scrollTo({top:0, behavior: opts.smooth ? "smooth" : "auto"});
      }
      try{ updateFloatNavVisibility(); }catch{}
      if(target === "stats"){
        try{ setRecordsTab(RECORDS_STATE.active); }catch{}
      }
      if(target === "works"){
        if(APP_READY){
          try{ loadAndRenderWorks(); }catch{}
        }else{
          WORKS_STATE.deferLoad = true;
        }
      }
    }

    function initAppNavigation(){
      document.querySelectorAll(".tabbar-btn").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          showPage(btn.dataset.tab || "inventory", {scrollTop:true, smooth:true});
        });
      });
      const rawSaved = (()=>{ try{ return localStorage.getItem(APP_PAGE_KEY) || "inventory"; }catch{ return "inventory"; }})();
      const saved = SUBPAGE_PARENT[rawSaved] ? SUBPAGE_PARENT[rawSaved] : rawSaved;
      showPage(saved, {scrollTop:false});
    }

    function syncHeaderHeight(){
      const header = document.querySelector("header");
      if(!header) return;
      const rect = header.getBoundingClientRect();
      if(rect && rect.height){
        document.documentElement.style.setProperty("--app-header-height", `${rect.height}px`);
      }
    }


    // ====== Card "更多" 菜单（紧凑布局） ======
    let OPEN_CARD_MENU = null;
    function closeCardMenu(){
      if(OPEN_CARD_MENU){
        OPEN_CARD_MENU.hidden = true;
        OPEN_CARD_MENU = null;
      }
    }

    // 根据色块背景（hex）计算对比文字色，避免数字看不清
    function contrastTextColor(hex){
      if(!hex || typeof hex!=="string") return "#111827";
      let h = hex.trim();
      if(h[0]==="#") h=h.slice(1);
      if(h.length===3) h = h.split("").map(c=>c+c).join("");
      if(h.length!==6) return "#111827";
      const r = parseInt(h.slice(0,2),16);
      const g = parseInt(h.slice(2,4),16);
      const b = parseInt(h.slice(4,6),16);
      // YIQ: 0(暗) - 255(亮)
      const yiq = (r*299 + g*587 + b*114) / 1000;
      // 背景偏亮用深色字，偏暗用浅色字
      return yiq >= 160 ? "#111827" : "#f6f8fb";
    }

    function formatNumber(value){
      const n = Number(value);
      if(!Number.isFinite(n)) return String(value ?? "0");
      return n.toLocaleString("en-US");
    }

    document.addEventListener("click", ()=>closeCardMenu());

    window.addEventListener("scroll", ()=>closeCardMenu(), { passive:true });

    // ====== Auth / Guest(Local) ======
    const TOKEN_KEY = "beads_token_v1";
    const GUEST_KEY = "beads_guest_data_v1";
    const GUEST_TIP_KEY = "beads_guest_tip_shown_v1";

    const SERIES_COLLAPSE_KEY = "beads_series_collapsed_v1";

    let COLLAPSED_SERIES = {};
    let LAST_IS_DEFAULT_VIEW = true;
    let SERIES_ANCHORS = [];

    try{
      const raw = localStorage.getItem(SERIES_COLLAPSE_KEY);
      if(raw) COLLAPSED_SERIES = JSON.parse(raw) || {};
    }catch{}

    let MASTER_PALETTE = [];
    let MASTER_CODES = [];
    let MASTER_HEX = {};
    let MASTER_SERIES = {};
    let MASTER_IS_DEFAULT = {};
    let DEFAULT_CODES = [];
    let NON_DEFAULT_SERIES = [];
    let SERIES_ORDER = [];

    function setMasterPalette(palette){
      const list = Array.isArray(palette) ? palette : [];
      MASTER_PALETTE = list;
      MASTER_CODES = [];
      MASTER_HEX = {};
      MASTER_SERIES = {};
      MASTER_IS_DEFAULT = {};
      DEFAULT_CODES = [];
      NON_DEFAULT_SERIES = [];
      SERIES_ORDER = [];
      const seriesSet = new Set();
      const nonDefaultSeriesSet = new Set();
      list.forEach((raw)=>{
        const code = String(raw?.code || "").trim().toUpperCase();
        if(!code) return;
        const hex = String(raw?.hex || "#777777");
        const series = String(raw?.series || "");
        const isDefault = !!raw?.isDefault;
        MASTER_CODES.push(code);
        MASTER_HEX[code] = hex;
        MASTER_SERIES[code] = series;
        MASTER_IS_DEFAULT[code] = isDefault;
        if(isDefault) DEFAULT_CODES.push(code);
        if(series) seriesSet.add(series);
        if(!isDefault && series) nonDefaultSeriesSet.add(series);
      });
      SERIES_ORDER = Array.from(seriesSet);
      NON_DEFAULT_SERIES = Array.from(nonDefaultSeriesSet);
    }

    let AUTH_TOKEN = (()=>{ try{ return localStorage.getItem(TOKEN_KEY) || ""; }catch{ return ""; } })();
    let IS_LOGGED_IN = false;
    let APP_READY = false;
    let USERNAME = "";

    // guest history: {gid, code, ts, type, qty, pattern, patternCategoryId, source}
    let GUEST_HISTORY = [];

    function saveGuest(){
      try{
        localStorage.setItem(GUEST_KEY, JSON.stringify({
          colors: COLORS,
          inventory: INVENTORY,
critical: CRITICAL_THRESHOLD,
          history: GUEST_HISTORY,
          patternCategories: PATTERN_CATEGORIES
        }));
      }catch{}
    }

    function loadGuest(){
      try{
        const raw = localStorage.getItem(GUEST_KEY);
        if(!raw) return false;
        const data = JSON.parse(raw);
        if(data && data.colors && data.inventory){
          COLORS = data.colors || {};
          INVENTORY = data.inventory || {};
CRITICAL_THRESHOLD = Number(data.critical ?? 300) || 300;
          GUEST_HISTORY = Array.isArray(data.history) ? data.history : [];
          PATTERN_CATEGORIES = Array.isArray(data.patternCategories) ? data.patternCategories : [];
          return true;
        }
      }catch{}
      return false;
    }

    async function loadMasterPalette(){
      try{
        const r = await fetch(apiUrl("/api/public/palette"));
        if(r.ok){
          const j = await r.json();
          const palette = Array.isArray(j.data) ? j.data : [];
          setMasterPalette(palette);
          return palette.length > 0;
        }
      }catch{}
      setMasterPalette([]);
      return false;
    }

    async function initGuestDefaults(){
      // 已有本地数据则不覆盖
      if(loadGuest()) return;

      if(MASTER_PALETTE.length===0){
        const ok = await loadMasterPalette();
        if(!ok){
          toast("色号列表加载失败，请检查服务端是否可用","error");
        }
      }

      COLORS = {};
      INVENTORY = {};

      if(MASTER_CODES.length>0){
        MASTER_CODES.forEach(c=>{
          COLORS[c] = MASTER_HEX[c] || "#777777";
          INVENTORY[c] = 1000;
        });
      }
      LAST_SYNC = null;
      PATTERN_CATEGORIES = [];
      saveGuest();
    }

    function setAuthUI(){
  const btnAuth = document.getElementById("btnAuth");
  const btnLogout = document.getElementById("btnLogout");
  const accountHelp = document.getElementById("accountHelp");

  if(IS_LOGGED_IN){
    if(btnAuth){
      btnAuth.textContent = (USERNAME ? USERNAME : "我的");
      btnAuth.classList.add("is-user");
    }
    if(accountHelp) accountHelp.textContent = "已同步到云端，可使用AI识别与多端同步";
    if(btnLogout){
      btnLogout.disabled = false;
      btnLogout.style.opacity = "1";
    }
  } else {
    if(btnAuth){
      btnAuth.textContent = "登录";
      btnAuth.classList.remove("is-user");
    }
    if(accountHelp) accountHelp.textContent = "登录后库存与记录会同步到云端";
    if(btnLogout){
      btnLogout.disabled = true;
      btnLogout.style.opacity = ".5";
    }
  }
}

    function nowIso(){return new Date().toISOString();}
    function pad2(n){return String(n).padStart(2,"0");}
function formatTimeSecondParts(iso){
      if(!iso) return {date:"", time:""};
      try{
        let d = (typeof iso==="number") ? new Date(iso) : new Date(iso);
        if(isNaN(d.getTime()) && typeof iso==="string"){
          d=new Date(iso.replace(" ","T"));
        }
        if(isNaN(d.getTime())) return {date:String(iso), time:""};
        const date = `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())}`;
        const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
        return {date, time};
      }catch{
        return {date:String(iso||""), time:""};
      }
    }
    function formatTimeMinuteString(iso){
      if(!iso) return "";
      try{
        let d = (typeof iso==="number") ? new Date(iso) : new Date(iso);
        if(isNaN(d.getTime()) && typeof iso==="string"){
          d=new Date(iso.replace(" ","T"));
        }
        if(isNaN(d.getTime())) return String(iso);
        return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      }catch{
        return String(iso||"");
      }
    }
    function formatDateOnly(iso){
      if(!iso) return "";
      try{
        let d = (typeof iso==="number") ? new Date(iso) : new Date(iso);
        if(isNaN(d.getTime()) && typeof iso==="string"){
          d=new Date(iso.replace(" ","T"));
        }
        if(isNaN(d.getTime())) return String(iso);
        return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
      }catch{
        return String(iso||"");
      }
    }
    function formatDurationMinutes(total){
      const mins = Number(total) || 0;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if(h > 0 && m > 0) return `${h}小时${m}分钟`;
      if(h > 0) return `${h}小时`;
      return `${m}分钟`;
    }
    function formatDurationShort(total){
      const mins = Number(total) || 0;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if(h > 0 && m > 0) return `${h}h${m}min`;
      if(h > 0) return `${h}h`;
      return `${m}min`;
    }
    function timePartsHtml(parts){
      const d = parts?.date ?? "";
      const t = parts?.time ?? "";
      return `<div class="dt-date">${escapeHtml(d)}</div><div class="dt-time">${escapeHtml(t)}</div>`;
    }

    function sortCodes(a,b){
      const ra = /^([A-Z])(\d{1,2})$/.exec(a);
      const rb = /^([A-Z])(\d{1,2})$/.exec(b);
      if(ra && rb){
        if(ra[1] !== rb[1]) return ra[1].charCodeAt(0) - rb[1].charCodeAt(0);
        return parseInt(ra[2],10) - parseInt(rb[2],10);
      }
      return a.localeCompare(b);
    }

    function normalizeCategoryName(name){
      return String(name || "").trim();
    }
    function categoryDisplayLength(name){
      let len = 0;
      const s = String(name || "");
      for(const ch of s){
        len += /[^\x00-\xff]/.test(ch) ? 2 : 1;
      }
      return len;
    }
    function isCategoryNameDuplicate(name, excludeId){
      const target = normalizeCategoryName(name).toLowerCase();
      if(!target) return false;
      return (PATTERN_CATEGORIES || []).some(c=>{
        const id = (c && c.id !== undefined && c.id !== null) ? String(c.id) : "";
        if(excludeId && String(excludeId) === id) return false;
        const cn = normalizeCategoryName(c?.name || "").toLowerCase();
        return cn === target;
      });
    }


    function _guestGroupKey(h){
      const g0 = h && h.gid ? String(h.gid) : "";
      if(g0) return g0;
      const ts = String(h?.ts || "").slice(0,16); // minute precision
      const pattern = String(h?.pattern || "");
      const source = String(h?.source || "");
      const type = String(h?.type || "");
      const cat = String(h?.patternCategoryId ?? "");
      return `legacy:${ts}|${pattern}|${source}|${type}|${cat}`;
    }

    function buildGuestRecordGroups(type, onlyWithPattern){
      type = String(type||"").toLowerCase();
      if(!["consume","restock"].includes(type)) return [];
      const groups = new Map();
      for(const h of (GUEST_HISTORY||[])){
        if(String(h?.type||"").toLowerCase() !== type) continue;
        const pat = String(h?.pattern || "");
        if(onlyWithPattern && !pat) continue;
        const cat = (h?.patternCategoryId === null || h?.patternCategoryId === undefined) ? null : h.patternCategoryId;

        const key = _guestGroupKey(h);
        let g = groups.get(key);
        if(!g){
          g = {gid:key, ts:h.ts, pattern: pat || "", patternCategoryId: cat, total:0, _items:[], workId: null};
          groups.set(key, g);
        }
        g.total += Number(h?.qty||0) || 0;
        if(String(h?.ts||"") < String(g.ts||"")) g.ts = h.ts;
        if(!g.pattern && pat) g.pattern = pat;
        if(g.patternCategoryId === null && cat !== null) g.patternCategoryId = cat;
        g._items.push(h);
      }

      const out = [];
      for(const g of groups.values()){
        const by = new Map();
        for(const it of g._items){
          const code = String(it?.code||"").toUpperCase();
          const qty = Number(it?.qty||0) || 0;
          by.set(code, (by.get(code)||0) + qty);
        }
        const detail = Array.from(by.entries()).map(([code,qty])=>({code, qty}))
          .sort((a,b)=> (b.qty-a.qty) || sortCodes(a.code,b.code));
        out.push({gid:g.gid, ts:g.ts, pattern:g.pattern, patternCategoryId: g.patternCategoryId, total:g.total, detail, workId: null});
      }
      out.sort((a,b)=> String(b.ts||"").localeCompare(String(a.ts||"")));
      return out;
    }

    function getGuestRecordGroupDetail(gid, type){
      gid = String(gid||"");
      type = String(type||"").toLowerCase();
      if(!gid) return [];
      const groups = buildGuestRecordGroups(type, false);
      const g = groups.find(x=>String(x.gid)===gid);
      return g ? (g.detail || []) : [];
    }

    function deleteGuestRecordGroup(gid, type){
      gid = String(gid||"");
      type = String(type||"").toLowerCase();
      if(!gid) return;

      const items = [];
      for(const h of (GUEST_HISTORY||[])){
        if(String(h?.type||"").toLowerCase() !== type) continue;
        if(_guestGroupKey(h) === gid) items.push(h);
      }
      if(items.length===0) return;

      for(const it of items){
        const code = String(it?.code||"").toUpperCase();
        const qty = Number(it?.qty||0) || 0;
        if(type==="consume") INVENTORY[code] = (INVENTORY[code]??0) + qty;
        else INVENTORY[code] = (INVENTORY[code]??0) - qty;
      }

      GUEST_HISTORY = (GUEST_HISTORY||[]).filter(h=>{
        if(String(h?.type||"").toLowerCase() !== type) return true;
        return _guestGroupKey(h) !== gid;
      });
    }

    function apiUrl(p){return `${API_BASE}${p}`;}


    function newRequestId(){
      try{
        if(window.crypto && typeof window.crypto.randomUUID==="function") return window.crypto.randomUUID();
      }catch{}
      return String(Date.now())+"-"+Math.random().toString(16).slice(2);
    }

    
    
    async function apiGet(path){
      // guest local short-circuit
      if(!IS_LOGGED_IN){
        if(path==="/api/all"){
          const data = Object.keys(COLORS).sort(sortCodes).map(code=>({
            code,
            hex: COLORS[code] || "#777777",
            qty: INVENTORY[code] ?? 0,
            series: MASTER_SERIES[code] || "",
            isDefault: MASTER_IS_DEFAULT[code] ? 1 : 0,
          }));
          return {ok:true,data};
        }
        if(path==="/api/settings"){
          return {ok:true, criticalThreshold: CRITICAL_THRESHOLD};
        }
        if(path==="/api/patternCategories"){
          const data = Array.isArray(PATTERN_CATEGORIES) ? PATTERN_CATEGORIES.slice() : [];
          return {ok:true, data};
        }
        if(path.startsWith("/api/history")){
          const url = new URL(apiUrl(path));
          const code = (url.searchParams.get("code")||"").toUpperCase();
          const rows = GUEST_HISTORY.filter(x=>x.code===code).sort((a,b)=> (b.ts||"").localeCompare(a.ts||"")).slice(0,200);
          return {ok:true,data: rows};
        }
        if(path.startsWith("/api/recordGroups")){
          const url = new URL(apiUrl(path));
          const type = String(url.searchParams.get("type")||"").toLowerCase();
          const only = url.searchParams.get("onlyWithPattern")==="1";
          const cat = url.searchParams.get("patternCategoryId");
          let data = buildGuestRecordGroups(type, only);
          if(type==="consume" && cat){
            data = data.filter(g=> String(g?.patternCategoryId ?? "") === String(cat));
          }
          return {ok:true, data};
        }
        if(path.startsWith("/api/recordGroupDetail")){
          const url = new URL(apiUrl(path));
          const gid = String(url.searchParams.get("gid")||"");
          const type = String(url.searchParams.get("type")||"").toLowerCase();
          const data = getGuestRecordGroupDetail(gid, type);
          return {ok:true, data};
        }
        if(path.startsWith("/api/consumeStats")){
          const by = new Map();
          const url = new URL(apiUrl(path));
          const daysRaw = Number(url.searchParams.get("days") || 0);
          const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.floor(daysRaw) : 0;
          const cutoff = days > 0 ? (Date.now() - days * 24 * 60 * 60 * 1000) : 0;
          for(const h of (GUEST_HISTORY||[])){
            if(String(h?.type||"").toLowerCase() !== "consume") continue;
            if(cutoff){
              const ts = (typeof h?.ts === "number") ? h.ts : Date.parse(h?.ts || "");
              if(!Number.isFinite(ts) || ts < cutoff) continue;
            }
            const code = String(h?.code||"").toUpperCase();
            const qty = Number(h?.qty||0) || 0;
            if(!code || qty<=0) continue;
            by.set(code, (by.get(code)||0) + qty);
          }
          const data = Array.from(by.entries()).map(([code, qty])=>({
            code,
            qty,
            hex: COLORS[code] || MASTER_HEX[code] || "#777777"
          }))
            .filter(x=>x.qty>0)
            .sort((a,b)=> (b.qty-a.qty) || sortCodes(String(a.code||""), String(b.code||"")));
          return {ok:true, data};
        }
        if(path.startsWith("/api/recordsStatsSummary")){
          let totalConsume = 0;
          let totalRestock = 0;
          for(const h of (GUEST_HISTORY||[])){
            const qty = Number(h?.qty||0) || 0;
            if(String(h?.type||"").toLowerCase() === "consume") totalConsume += qty;
            if(String(h?.type||"").toLowerCase() === "restock") totalRestock += qty;
          }
          const totalInventory = Object.values(INVENTORY||{}).reduce((acc, v)=> acc + (Number(v)||0), 0);
          const consumeCount = buildGuestRecordGroups("consume", false).length;
          const restockCount = buildGuestRecordGroups("restock", false).length;
          return {
            ok:true,
            data: { totalConsume, totalRestock, totalInventory, consumeCount, restockCount }
          };
        }

      }

      const headers = {};
      if(AUTH_TOKEN) headers["authorization"] = `Bearer ${AUTH_TOKEN}`;
      const res = await fetch(apiUrl(path),{headers});
      if(!res.ok){
        let msg = "api error";
        try{
          const j = await res.json();
          if(j && (j.message||j.error)) msg = j.message||j.error;
        }catch{}
        const err = new Error(msg);
        err.httpStatus = res.status;
        throw err;
      }
      return res.json();
    }


    
    async function apiPostForm(path, formData){
      if(!IS_LOGGED_IN && path==="/api/recognize-pattern"){
        // 未登录：禁止AI
        toast("请登录后使用AI功能","warn");
        const err = new Error("unauthorized");
        err.httpStatus = 401;
        throw err;
      }

      const headers = {};
      if(AUTH_TOKEN) headers["authorization"] = `Bearer ${AUTH_TOKEN}`;
      const res = await fetch(apiUrl(path),{
        method:"POST",
        headers,
        body: formData
      });
      if(!res.ok){
        let msg = "api error";
        try{
          const j = await res.json();
          if(j && (j.message||j.error)) msg = j.message||j.error;
        }catch{}
        const err = new Error(msg);
        err.httpStatus = res.status;
        throw err;
      }
      return res.json();
    }


    
    async function apiPost(path,data,opts){
      opts = opts || {};
      const extraHeaders = (opts && opts.headers) ? opts.headers : {};

      // guest local short-circuit
      if(!IS_LOGGED_IN){

        if(path==="/api/workPublish"){
          toast("请登录后发布作品","warn");
          const err = new Error("unauthorized");
          err.httpStatus = 401;
          throw err;
        }
        if(path==="/api/workUpdate" || path==="/api/workDelete"){
          toast("请登录后发布作品","warn");
          const err = new Error("unauthorized");
          err.httpStatus = 401;
          throw err;
        }

        if(path==="/api/patternCategories"){
          const name = normalizeCategoryName(data?.name);
          if(!name) throw new Error("请输入分类名称");
          if(categoryDisplayLength(name) > 12) throw new Error("分类名称最多6个中文或12个英文");
          if(isCategoryNameDuplicate(name)) throw new Error("分类已存在");
          if((PATTERN_CATEGORIES||[]).length >= MAX_PATTERN_CATEGORIES){
            throw new Error(`最多只能创建${MAX_PATTERN_CATEGORIES}个分类`);
          }
          const id = newRequestId();
          PATTERN_CATEGORIES = Array.isArray(PATTERN_CATEGORIES) ? PATTERN_CATEGORIES : [];
          PATTERN_CATEGORIES.push({id, name, createdAt: new Date().toISOString()});
          saveGuest();
          return {ok:true, id, name};
        }

        if(path==="/api/patternCategoryDelete"){
          const id = data?.id;
          if(!id) throw new Error("invalid id");
          PATTERN_CATEGORIES = (PATTERN_CATEGORIES||[]).filter(c=> String(c?.id||"") !== String(id));
          GUEST_HISTORY = (GUEST_HISTORY||[]).map(h=>{
            if(String(h?.patternCategoryId ?? "") === String(id)){
              return {...h, patternCategoryId: null};
            }
            return h;
          });
          saveGuest();
          return {ok:true};
        }

        if(path==="/api/patternCategoryUpdate"){
          const id = data?.id;
          const name = normalizeCategoryName(data?.name);
          if(!id) throw new Error("invalid id");
          if(!name) throw new Error("请输入分类名称");
          if(categoryDisplayLength(name) > 12) throw new Error("分类名称最多6个中文或12个英文");
          if(isCategoryNameDuplicate(name, id)) throw new Error("分类已存在");
          PATTERN_CATEGORIES = (PATTERN_CATEGORIES||[]).map(c=>{
            if(String(c?.id||"") === String(id)){
              return {...c, name};
            }
            return c;
          });
          saveGuest();
          return {ok:true};
        }

        if(path==="/api/recordGroupDelete"){
          const gid = String(data?.gid||"");
          const type = String(data?.type||"").toLowerCase();
          if(!gid) throw new Error("missing gid");
          if(!["consume","restock"].includes(type)) throw new Error("invalid type");
          deleteGuestRecordGroup(gid, type);
          saveGuest();
          return {ok:true, criticalThreshold: CRITICAL_THRESHOLD};
        }

        if(path==="/api/recordGroupUpdate"){
          const gid = String(data?.gid||"");
          const type = String(data?.type||"").toLowerCase();
          const items = Array.isArray(data?.items) ? data.items : [];
          const hasPattern = Object.prototype.hasOwnProperty.call(data || {}, "pattern");
          const patternRaw = hasPattern ? String(data?.pattern || "").trim() : "";
          const pattern = (hasPattern && patternRaw) ? patternRaw : null;
          const hasPatternCategory = Object.prototype.hasOwnProperty.call(data || {}, "patternCategoryId");
          const patternCategoryValue = hasPatternCategory ? data?.patternCategoryId : null;
          if(!gid) throw new Error("missing gid");
          if(!["consume","restock"].includes(type)) throw new Error("invalid type");
          if(items.length===0) throw new Error("invalid items");

          const groupItems = (GUEST_HISTORY||[]).filter(h=>{
            if(String(h?.type||"").toLowerCase() !== type) return false;
            return _guestGroupKey(h) === gid;
          });
          if(groupItems.length===0) throw new Error("group not found");

          const baseTs = groupItems.reduce((acc,it)=>{
            if(!acc) return it.ts;
            return String(it.ts||"") < String(acc||"") ? it.ts : acc;
          }, groupItems[0]?.ts);
          const baseSource = String(groupItems[0]?.source || "");
          const basePattern = String(groupItems[0]?.pattern || "");
          const basePatternCategory = (groupItems[0]?.patternCategoryId === undefined) ? null : groupItems[0]?.patternCategoryId;
          const finalPattern = type==="consume"
            ? (hasPattern ? pattern : (basePattern || null))
            : (basePattern || null);
          const finalPatternCategoryId = type==="consume"
            ? (hasPatternCategory ? (patternCategoryValue ?? null) : (basePatternCategory ?? null))
            : null;

          const oldMap = new Map();
          groupItems.forEach(it=>{
            const code = String(it?.code||"").toUpperCase();
            const qty = Number(it?.qty||0) || 0;
            if(!code || qty<=0) return;
            oldMap.set(code, (oldMap.get(code)||0) + qty);
          });

          const newMap = new Map();
          for(const it of items){
            const code = String(it?.code||"").trim().toUpperCase();
            const qty = Number(it?.qty);
            if(!code) throw new Error("invalid code");
            if(!(code in INVENTORY) || !(code in COLORS)) throw new Error("unknown code");
            if(!Number.isInteger(qty) || qty<=0) throw new Error("invalid qty");
            newMap.set(code, (newMap.get(code)||0) + Math.abs(Math.floor(qty)));
          }

          const union = new Set([...oldMap.keys(), ...newMap.keys()]);
          union.forEach(code=>{
            const oldQty = oldMap.get(code) || 0;
            const newQty = newMap.get(code) || 0;
            const diff = newQty - oldQty;
            if(diff===0) return;
            if(type==="consume") INVENTORY[code] = (INVENTORY[code]??0) - diff;
            else INVENTORY[code] = (INVENTORY[code]??0) + diff;
          });

          GUEST_HISTORY = (GUEST_HISTORY||[]).filter(h=>{
            if(String(h?.type||"").toLowerCase() !== type) return true;
            return _guestGroupKey(h) !== gid;
          });

          for(const [code, qty] of newMap.entries()){
            GUEST_HISTORY.unshift({
              gid,
              code,
              ts: baseTs || new Date().toISOString(),
              type,
              qty,
              pattern: finalPattern,
              patternCategoryId: finalPatternCategoryId,
              source: baseSource
            });
          }
          saveGuest();
          return {ok:true};
        }

        if(path==="/api/adjust"){
          const code = String(data?.code||"").trim().toUpperCase();
          const type = String(data?.type||"");
          const qty = Number(data?.qty);
          const pattern = data?.pattern || null;
          const patternCategoryId = type==="consume" ? (data?.patternCategoryId ?? null) : null;
          if(!code) throw new Error("invalid code");
	          if(!(code in INVENTORY) || !(code in COLORS)) throw new Error("unknown code");
          if(!Number.isInteger(qty) || qty<=0) throw new Error("invalid qty");
          if(type==="consume") INVENTORY[code] = (INVENTORY[code]??0) - qty;
          else if(type==="restock") INVENTORY[code] = (INVENTORY[code]??0) + qty;
          else throw new Error("invalid type");

          const gid = newRequestId();


          GUEST_HISTORY.unshift({
            gid,
            code,
            ts: new Date().toISOString(),
            type,
            qty,
            pattern,
            patternCategoryId,
            source: String(data?.source||"manual")
          });
          saveGuest();
          return {ok:true, qty: INVENTORY[code]};
        }

        if(path==="/api/adjustBatch"){
          const items = Array.isArray(data?.items) ? data.items : [];
          if(items.length===0) throw new Error("invalid items");
          const gid = newRequestId();

          for(const it of items){
            const code = String(it?.code||"").trim().toUpperCase();
            const type = String(it?.type||"");
            const qty = Number(it?.qty);
            const pattern = it?.pattern || null;
            const patternCategoryId = type==="consume" ? (it?.patternCategoryId ?? data?.patternCategoryId ?? null) : null;
            if(!code) throw new Error("invalid code");
	            if(!(code in INVENTORY) || !(code in COLORS)) throw new Error("unknown code");
            if(!Number.isInteger(qty) || qty<=0) throw new Error("invalid qty");
            if(type==="consume") INVENTORY[code] = (INVENTORY[code]??0) - qty;
            else if(type==="restock") INVENTORY[code] = (INVENTORY[code]??0) + qty;
            else throw new Error("invalid type");

            GUEST_HISTORY.unshift({
              gid,
              code,
              ts: new Date().toISOString(),
              type,
              qty,
              pattern,
              patternCategoryId,
              source: String(it?.source||"manual")
            });
          }
          saveGuest();
          return {ok:true};
        }

        if(path==="/api/settings"){
          // 虽然未登录隐藏设置，但仍可写入本地（避免其他地方调用报错）
          CRITICAL_THRESHOLD = Number(data?.criticalThreshold ?? CRITICAL_THRESHOLD) || CRITICAL_THRESHOLD;
          saveGuest();
          return {ok:true, criticalThreshold: CRITICAL_THRESHOLD};
        }
        if(path==="/api/addColor"){
	          const code = String(data?.code||"").trim().toUpperCase();
	          if(!code) throw new Error("invalid code");
	          if(!MASTER_HEX[code]) throw new Error("非MARD色号，请检查后重新输入");
	          if(code in COLORS) throw new Error("色号已存在");
	          COLORS[code] = MASTER_HEX[code];
	          if(!(code in INVENTORY)) INVENTORY[code] = 0;
	          saveGuest();
	          return {ok:true};
        }

	        if(path==="/api/removeColor"){
	          const code = String(data?.code||"").trim().toUpperCase();
	          if(!code) throw new Error("invalid code");
	          if(!(code in COLORS)) throw new Error("unknown code");
	          delete COLORS[code];
	          delete INVENTORY[code];
	          GUEST_HISTORY = (GUEST_HISTORY||[]).filter(h=>String(h.code||"").toUpperCase()!==code);
	          saveGuest();
	          return {ok:true};
	        }

        if(path==="/api/resetAll"){
          // 重置库存：数量归零 + 清空历史 + 移除所有非默认色号
          Object.keys(COLORS).forEach(code=>{ INVENTORY[code]=1000; });
          Object.keys(COLORS).forEach(code=>{
            if(!MASTER_IS_DEFAULT[code]){
              delete COLORS[code];
              delete INVENTORY[code];
            }
          });
          GUEST_HISTORY = [];
          saveGuest();
          return {ok:true};
        }

        if(path==="/api/addSeries"){
          const series = String(data?.series || "").trim();
          if(!series) return {ok:false,message:"missing series"};
          if(!NON_DEFAULT_SERIES.includes(series)) return {ok:false,message:"invalid series"};
          // 添加该系列所有非默认色号到库存（qty=0）
          MASTER_PALETTE.filter(x=>x.series===series && !x.isDefault).forEach(x=>{
            if(!(x.code in COLORS)) COLORS[x.code] = x.hex;
            if(!(x.code in INVENTORY)) INVENTORY[x.code] = 0;
          });
          saveGuest();
          return {ok:true};
        }

        if(path==="/api/removeSeries"){
          const series = String(data?.series || "").trim();
          if(!series) return {ok:false,message:"missing series"};
          if(!NON_DEFAULT_SERIES.includes(series)) return {ok:false,message:"invalid series"};
          const toRemove = MASTER_PALETTE.filter(x=>x.series===series && !x.isDefault).map(x=>x.code);
          toRemove.forEach(code=>{
            delete COLORS[code];
            delete INVENTORY[code];
          });
          // 清空该系列相关历史
          GUEST_HISTORY = (GUEST_HISTORY||[]).filter(h=>!toRemove.includes(String(h.code||"").toUpperCase()));
          saveGuest();
          return {ok:true};
        }

      }

      const headers = {"content-type":"application/json", ...extraHeaders};
      if(AUTH_TOKEN) headers["authorization"] = `Bearer ${AUTH_TOKEN}`;

      const res = await fetch(apiUrl(path),{
        method:"POST",
        headers,
        body:JSON.stringify(data||{})
      });
      if(!res.ok){
        let msg = "api error";
        try{
          const j = await res.json();
          if(j && (j.message||j.error)) msg = j.message||j.error;
        }catch{}
        const err = new Error(msg);
        err.httpStatus = res.status;
        throw err;
      }
      return res.json();
    }

  // ----- modal helpers (do NOT use dialog.showModal; keep toast above overlay) -----
  let __backdrop = null;
  function __ensureBackdrop(){
    if(__backdrop) return __backdrop;
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.addEventListener('click', () => {
// If a locked modal is open, ignore backdrop clicks
if(document.querySelector('dialog[open][data-lock-backdrop="1"]')) return;
// If a sub-modal is open, only close that one (don't affect underlying dialog)
if(bd.classList.contains('submodal')){
  const sub = document.querySelector('dialog[open][data-submodal="1"]');
  if(sub){ try{ sub.close(); }catch{} }
  bd.classList.remove('submodal');
  __refreshBackdrop();
  return;
}
document.querySelectorAll('dialog[open]').forEach(d => d.close());
__refreshBackdrop();
});
    document.body.appendChild(bd);
    __backdrop = bd;
    return bd;
  }
  function __refreshBackdrop(){
    const anyOpen = document.querySelector('dialog[open]');
    const bd = __ensureBackdrop();
    if(anyOpen){
      bd.classList.add('show');
      document.body.classList.add('modal-open');
    }else{
      bd.classList.remove('show');
      document.body.classList.remove('modal-open');
    }
  }
  function openDialog(d){
    if(!d) return;
    __ensureBackdrop();
    // Use dialog.show() (non-modal) + custom backdrop so toast can stay above overlay.
    if(!d.open){
      try{ d.show(); } catch(e){ d.setAttribute('open',''); }
    }
    // Keep backdrop in sync even if user presses ESC or calls .close()
    if(!d.__bdHooked){
      d.addEventListener('close', __refreshBackdrop);
      d.addEventListener('cancel', (ev)=>{ ev.preventDefault(); d.close(); __refreshBackdrop(); });
      d.__bdHooked = true;
    }
    __refreshBackdrop();
  }
  function closeDialog(d){
    if(!d) return;
    try{ d.close(); }catch{}
    __refreshBackdrop();
  }

  // ----- global loading overlay -----
  let __globalLoadingCount = 0;
  let __globalLoadingEl = null;
  let __globalLoadingText = null;
  let __globalLoadingKeyHandler = null;
  function __ensureGlobalLoading(){
    if(__globalLoadingEl) return __globalLoadingEl;
    __globalLoadingEl = document.getElementById("globalLoading");
    __globalLoadingText = document.getElementById("globalLoadingText");
    return __globalLoadingEl;
  }
  function showGlobalLoading(message){
    const el = __ensureGlobalLoading();
    if(!el) return;
    __globalLoadingCount = Math.max(0, __globalLoadingCount) + 1;
    if(message && __globalLoadingText) __globalLoadingText.textContent = message;
    el.classList.add("show");
    el.setAttribute("aria-hidden","false");
    document.body.setAttribute("aria-busy","true");
    document.body.classList.add("loading-open");
    try{ el.focus(); }catch{}
    if(__globalLoadingCount === 1){
      __globalLoadingKeyHandler = (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
      };
      document.addEventListener("keydown", __globalLoadingKeyHandler, true);
    }
  }
  function hideGlobalLoading(){
    const el = __ensureGlobalLoading();
    if(!el) return;
    __globalLoadingCount = Math.max(0, __globalLoadingCount - 1);
    if(__globalLoadingCount > 0) return;
    el.classList.remove("show");
    el.setAttribute("aria-hidden","true");
    document.body.removeAttribute("aria-busy");
    document.body.classList.remove("loading-open");
    if(__globalLoadingKeyHandler){
      document.removeEventListener("keydown", __globalLoadingKeyHandler, true);
      __globalLoadingKeyHandler = null;
    }
  }
  window.showGlobalLoading = showGlobalLoading;
  window.hideGlobalLoading = hideGlobalLoading;

function toast(message,type="success"){
      const stack=document.getElementById("toastStack");
      const el=document.createElement("div");
      el.className="toast "+type;
      el.style.color=type==="error"?"var(--danger)":"var(--accent)";
      const dot=document.createElement("span");
      dot.className="toast-dot";
      const msg=document.createElement("span");
      msg.textContent=message;
      el.appendChild(dot);el.appendChild(msg);
      stack.appendChild(el);
      setTimeout(()=>{el.style.opacity="0";el.style.transform="translateY(4px)";},2200);
      setTimeout(()=>el.remove(),2600);
    }

    function buildPill(code, qty){
      const pill=document.createElement("span");
      pill.className="pill";
      const sw=document.createElement("span");
      sw.className="swatch";
      sw.style.background=COLORS[code]||"#999";
      const t=document.createElement("span");
      if(typeof qty === "number"){
        t.textContent=`${code} ${formatNumber(qty)}`;
      }else{
        t.textContent=code;
      }
      pill.appendChild(sw);pill.appendChild(t);
      return pill;
    }

    function computeStats(){
      const codes=Object.keys(COLORS).sort(sortCodes);
      let tight=0,sum=0;
      codes.forEach(c=>{
        const v=INVENTORY[c]??0;
        sum+=v;
        if(v<CRITICAL_THRESHOLD) tight++;
      });
      return{count:codes.length,tight,sum};
    }

    function renderAlerts(){
      const ltCritical=[];
      Object.keys(COLORS).forEach(code=>{
        const remain=Number(INVENTORY[code]??0) || 0;
        if(remain<CRITICAL_THRESHOLD) ltCritical.push({code, remain});
      });
      ltCritical.sort((a,b)=>{
        if(a.remain!==b.remain) return a.remain-b.remain;
        return sortCodes(a.code,b.code);
      });

      const list300=document.getElementById("listLt300");
      if(list300){
        list300.innerHTML="";
        if(ltCritical.length===0) list300.innerHTML='<span class="empty">暂无</span>';
        else ltCritical.forEach(({code, remain})=>{
          list300.appendChild(buildPill(code, remain));
        });
      }

      const countEl=document.getElementById("countLt300");
      if(countEl) countEl.textContent = `色号数量：${ltCritical.length}`;

      const panel=document.getElementById("alertsPanel");
      if(panel) panel.style.display = (ltCritical.length===0) ? "none" : "";
    }

    function renderMeta(){
      const {count,tight,sum}=computeStats();
      document.getElementById("metaTotal").textContent=`色号数量：${count} · 总库存：${sum}`;
      }


    function iosIcon(name){
      switch(name){
        case "chevronDown":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg>';
        case "chevronUp":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 14l-6-6-6 6"/></svg>';
        case "chevronRight":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6l6 6-6 6"/></svg>';
        default:
          return "";
      }
    }

    function saveCollapsedSeries(){
      try{ localStorage.setItem(SERIES_COLLAPSE_KEY, JSON.stringify(COLLAPSED_SERIES||{})); }catch{}
    }

    function refreshSeriesAnchors(){
      const grid = document.getElementById("inventoryGrid");
      if(!grid){ SERIES_ANCHORS=[]; return; }
      SERIES_ANCHORS = Array.from(grid.querySelectorAll(".series-section .series-header[data-series]"))
        .map(el=>({series: el.dataset.series, el}));
    }

    function getCurrentSeriesIndex(){
      if(!SERIES_ANCHORS.length) return -1;
      const y = window.scrollY + 90;
      let idx = 0;
      for(let i=0;i<SERIES_ANCHORS.length;i++){
        const top = SERIES_ANCHORS[i].el.getBoundingClientRect().top + window.scrollY;
        if(top <= y) idx = i;
        else break;
      }
      return idx;
    }

    function scrollToSeriesIndex(i){
      if(i<0 || i>=SERIES_ANCHORS.length) return;
      const top = SERIES_ANCHORS[i].el.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({top, behavior:"smooth"});
    }

    function updateFloatNavVisibility(){
      const nav = document.getElementById("mobileFloatNav");
      if(!nav) return;
      if(document.body.dataset.page !== "inventory"){
        nav.hidden = true;
        return;
      }
      const show = (window.innerWidth<=720)
        && LAST_IS_DEFAULT_VIEW
        && SERIES_ANCHORS.length>1
        && (window.scrollY >= window.innerHeight);
      nav.hidden = !show;
    }

    function renderInventoryGrid(){
      const grid=document.getElementById("inventoryGrid");
      grid.innerHTML="";
      const codes=Object.keys(COLORS).sort(sortCodes);
      const filtered=codes.slice();

      const cmp=(a,b)=>{
        if(!SORT_MODE) return sortCodes(a,b);
        const qa = INVENTORY[a] ?? 0;
        const qb = INVENTORY[b] ?? 0;
        if(SORT_MODE==="asc") return (qa-qb) || sortCodes(a,b);
        if(SORT_MODE==="desc") return (qb-qa) || sortCodes(a,b);
        return sortCodes(a,b);
      };

      const buildCard=(code)=>{
        const remain=INVENTORY[code]??0;
        const hex=COLORS[code]||"#777";

        const status=document.createElement("span");
        let statusClass="ok",statusText="库存充足";
        if(remain<0){statusClass="debt";statusText="欠账";}
        else if(remain<CRITICAL_THRESHOLD){statusClass="warn";statusText="库存紧张";}
        status.className="status "+statusClass;
        status.textContent=statusText;

        const card=document.createElement("div");
        card.className="card"+(remain<0?" debt":"")+(VIEW_MODE==="compact"?" compact":"");

        const codeEl=document.createElement("div");
        codeEl.className="code";
        codeEl.textContent=code;

        // —— 紧凑布局：头部（色号+标签+更多） + 下方色块数量 —— 
        if(VIEW_MODE==="compact"){
          const top=document.createElement("div");
          top.className="card-top";

          const spacer=document.createElement("div");
          spacer.className="spacer";

          const moreBtn=document.createElement("button");
          moreBtn.type="button";
          moreBtn.className="icon-btn card-more-btn";
          moreBtn.setAttribute("aria-label","更多操作");
          moreBtn.textContent="⋯";

          const menu=document.createElement("div");
          menu.className="card-menu";
          menu.hidden=true;

          const adjustItem=document.createElement("button");
          adjustItem.type="button";
          adjustItem.className="menu-item";
          adjustItem.textContent="调整库存";
          adjustItem.addEventListener("click",(e)=>{
            e.stopPropagation();
            closeCardMenu();
            openAdjust(code);
          });

          const detailItem=document.createElement("button");
          detailItem.type="button";
          detailItem.className="menu-item";
          detailItem.textContent="查看明细";
          detailItem.addEventListener("click",(e)=>{
            e.stopPropagation();
            closeCardMenu();
            openDetail(code);
          });

          menu.appendChild(adjustItem);
          menu.appendChild(detailItem);

          moreBtn.addEventListener("click",(e)=>{
            e.stopPropagation();

            // 关闭其他卡片的菜单
            if(OPEN_CARD_MENU && OPEN_CARD_MENU!==menu){
              OPEN_CARD_MENU.hidden=true;
            }
            const willOpen = menu.hidden;

            closeCardMenu();
            if(willOpen){
              menu.hidden=false;
              OPEN_CARD_MENU=menu;
            }
          });

          const block=document.createElement("div");
          block.className="compact-block";
          block.style.backgroundColor=hex;

          const remainEl=document.createElement("div");
          remainEl.className="compact-remain"+(remain<0?" debt":"");
          remainEl.innerHTML=`${remain}<small>粒</small>`;

          // 数字颜色：根据色块背景自动取对比色，避免看不清
          if(remain>=0){
            remainEl.style.color = contrastTextColor(hex);
          }

          block.appendChild(remainEl);

          top.appendChild(codeEl);
          top.appendChild(status);
          top.appendChild(spacer);
          top.appendChild(moreBtn);

          card.appendChild(top);
          card.appendChild(block);
          card.appendChild(menu);

          return card;
        }

        // —— 标准布局（原样保留） —— 
        const sw=document.createElement("div");
        sw.className="color-block";
        sw.style.background=hex;

        const remainEl=document.createElement("div");
        remainEl.className="remain"+(remain<0?" debt":"");
        remainEl.innerHTML=`${remain}<small>粒</small>`;

        const actions=document.createElement("div");
        actions.className="card-actions";

        const adjustBtn=document.createElement("button");
        adjustBtn.textContent="调整库存";
        adjustBtn.addEventListener("click",()=>openAdjust(code));

        const detailBtn=document.createElement("button");
        detailBtn.textContent="查看明细";
        detailBtn.addEventListener("click",()=>openDetail(code));

        actions.appendChild(adjustBtn);
        actions.appendChild(detailBtn);

        card.appendChild(codeEl);
        card.appendChild(sw);
        card.appendChild(remainEl);
        card.appendChild(status);
        card.appendChild(actions);

        return card;
      };

      // ✅ 仅当“默认排序”时按系列分区展示；使用余量排序（升/降）时按整体结果展示
      // （已移除：搜索色号/余量小于筛选）
      const isDefaultView = (!SORT_MODE);
      LAST_IS_DEFAULT_VIEW = isDefaultView;
      const all = filtered.slice().sort(cmp);

      if(all.length===0){
        const empty=document.createElement("div");
        empty.className="empty";
        empty.textContent="没有符合筛选条件的色号";
        grid.appendChild(empty);
        refreshSeriesAnchors();
        updateFloatNavVisibility();
        return;
      }

      if(!isDefaultView){
        LAST_IS_DEFAULT_VIEW = false;
        const inner=document.createElement("div");
        inner.className="series-grid";
        all.forEach(code=> inner.appendChild(buildCard(code)));
        grid.appendChild(inner);
        refreshSeriesAnchors();
        updateFloatNavVisibility();
        return;
      }

      // 默认视图：按系列分组展示
      const groups=new Map();
      for(const code of all){
        const series=MASTER_SERIES[code] || "未分组";
        if(!groups.has(series)) groups.set(series, []);
        groups.get(series).push(code);
      }

      const seriesList = SERIES_ORDER
        .filter(s=>groups.has(s))
        .concat(Array.from(groups.keys()).filter(s=>!SERIES_ORDER.includes(s)).sort());

      seriesList.forEach(series=>{
        const section=document.createElement("div");
        section.className="series-section";
        section.dataset.series = series;

        const inner=document.createElement("div");
        inner.className="series-grid";

        const arr = (groups.get(series) || []).slice().sort(cmp);
        arr.forEach(code=> inner.appendChild(buildCard(code)));

        const count = arr.length;
        const totalQty = arr.reduce((s,code)=> s + (Number(INVENTORY[code] ?? 0) || 0), 0);

        const header=document.createElement("div");
        header.className="series-header";
        header.dataset.series = series;

        const title=document.createElement("div");
        title.className="series-title";
        title.textContent = series;

        const actions=document.createElement("div");
        actions.className="series-actions";

        const stats=document.createElement("span");
        stats.className="series-stats";
        stats.textContent = `${count}色号 · ${totalQty}粒`;

        const toggle=document.createElement("button");
        toggle.className="series-collapse-btn";
        toggle.type = "button";
        toggle.dataset.series = series;

        const isCollapsed = !!COLLAPSED_SERIES[series];
        if(isCollapsed){
          section.classList.add("collapsed");
          inner.style.display = "none";
          toggle.innerHTML = iosIcon("chevronRight");
          toggle.setAttribute("aria-label","展开");
        }else{
          toggle.innerHTML = iosIcon("chevronDown");
          toggle.setAttribute("aria-label","收起");
        }

        toggle.addEventListener("click",(e)=>{
          e.stopPropagation();
          const collapsed = section.classList.toggle("collapsed");
          if(collapsed){
            inner.style.display = "none";
            toggle.innerHTML = iosIcon("chevronRight");
            toggle.setAttribute("aria-label","展开");
            COLLAPSED_SERIES[series] = true;
          }else{
            inner.style.display = "";
            toggle.innerHTML = iosIcon("chevronDown");
            toggle.setAttribute("aria-label","收起");
            delete COLLAPSED_SERIES[series];
          }
          saveCollapsedSeries();
          requestAnimationFrame(()=>{ refreshSeriesAnchors(); updateFloatNavVisibility(); });
        });

        actions.appendChild(stats);
        actions.appendChild(toggle);

        header.appendChild(title);
        header.appendChild(actions);

        section.appendChild(header);
        section.appendChild(inner);
        grid.appendChild(section);
      });

      refreshSeriesAnchors();
      updateFloatNavVisibility();
    }
    function renderAll(){
      renderAlerts();
      renderMeta();
      renderInventoryGrid();
    }

    function updateThresholdUI(){
      const labelCritical=document.getElementById("labelCriticalThreshold");
      if(labelCritical) labelCritical.textContent=CRITICAL_THRESHOLD;
    }

    async function loadSettings(){
      try{
        const res=await apiGet("/api/settings");
        const ct=Number(res.criticalThreshold);
        if(Number.isFinite(ct)&&ct>0) CRITICAL_THRESHOLD=ct;
}catch{}
      updateThresholdUI();
      const input = document.getElementById("criticalInput");
      if(input) input.value = CRITICAL_THRESHOLD;
    }

    async function syncAll(){
      const res=await apiGet("/api/all");
      const list=res.data||[];
      COLORS={};INVENTORY={};
      list.forEach(i=>{
        COLORS[i.code]=i.hex;
        INVENTORY[i.code]=Number(i.qty||0);
      });
      LAST_SYNC=nowIso();
      renderAll();
      try{ renderSeriesManager(); }catch{}
    }

    // 明细
    const detailDialog=document.getElementById("detailDialog");
    const confirmDialog = document.getElementById("confirmDialog");
    const confirmDialogTitle = document.getElementById("confirmDialogTitle");
    const confirmDialogText = document.getElementById("confirmDialogText");
    const confirmDialogClose = document.getElementById("confirmDialogClose");
    const confirmDialogCancel = document.getElementById("confirmDialogCancel");
    const confirmDialogConfirm = document.getElementById("confirmDialogConfirm");
    let CONFIRM_PENDING = null;
    let CONFIRM_CLOSE_HOOKED = false;

    function openConfirmDialog({title, text, confirmLabel, confirmClass, onConfirm}){
      if(!confirmDialog) return;
      if(confirmDialogTitle) confirmDialogTitle.textContent = title || "确认操作";
      if(confirmDialogText) confirmDialogText.textContent = text || "";
      if(confirmDialogConfirm){
        confirmDialogConfirm.textContent = confirmLabel || "确认";
        confirmDialogConfirm.className = confirmClass || "btn-danger";
      }
      CONFIRM_PENDING = onConfirm || null;
      if(!CONFIRM_CLOSE_HOOKED){
        const onClose = ()=>{ CONFIRM_PENDING = null; if(confirmDialogConfirm) confirmDialogConfirm.disabled = false; };
        confirmDialog.addEventListener("close", onClose);
        confirmDialog.addEventListener("cancel", onClose);
        CONFIRM_CLOSE_HOOKED = true;
      }
      openDialog(confirmDialog);
    }
    function closeConfirmDialog(){
      closeDialog(confirmDialog);
      CONFIRM_PENDING = null;
      if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
    }

    let CURRENT_DETAIL_CODE = null;
	    document.getElementById("detailClose").addEventListener("click",()=>closeDialog(detailDialog));
	    document.getElementById("detailDelete").addEventListener("click", async ()=>{
	      const code = CURRENT_DETAIL_CODE;
	      if(!code) return;
        openConfirmDialog({
          title: "删除色号",
          text: "删除色号将清空库存和明细，是否确认删除？",
          confirmLabel: "确认删除",
          confirmClass: "btn-danger",
          onConfirm: async ()=>{
            try{
              if(confirmDialogConfirm) confirmDialogConfirm.disabled = true;
              await apiPost("/api/removeColor", {code});
              closeConfirmDialog();
              closeDialog(detailDialog);
              await syncAll();
              toast("删除成功");
            }catch(e){
              if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
              toast(e?.message || "删除失败","error");
            }
          }
        });
	    });

    async function openDetail(code){
      try{
	        CURRENT_DETAIL_CODE = String(code||"").toUpperCase();
        const res=await apiGet(`/api/history?code=${encodeURIComponent(code)}`);
        const history=(res.data||[]).slice();
        const remain=INVENTORY[code]??0;
        document.getElementById("detailTitle").textContent=`色号 ${code} 明细`;
        document.getElementById("detailRemain").textContent=`余量：${remain} 粒`;
        document.getElementById("detailTotalConsume").textContent=`总消耗：${res.totalConsume||0}`;
        document.getElementById("detailTotalRestock").textContent=`总补充：${res.totalRestock||0}`;
        const tbody=document.getElementById("detailTableBody");
        const empty=document.getElementById("detailEmpty");
        tbody.innerHTML="";
        if(history.length===0){
          empty.style.display="block";
        }else{
          empty.style.display="none";
          history.forEach(item=>{
            const tr=document.createElement("tr");
            const ts = item.ts ?? item.created_at ?? item.createdAt ?? item.time ?? item.created ?? null;
            const type = item.type ?? item.htype ?? item.op ?? item.action ?? null;
            const qty = item.qty ?? item.amount ?? item.num ?? 0;
            const pattern = item.pattern ?? item.patternName ?? item.paper_name ?? item.paperName ?? "";
            const source = item.source ?? "";

            const tdTime=document.createElement("td");
            tdTime.className="time";
            const tpp = formatTimeSecondParts(ts);
            tdTime.innerHTML = timePartsHtml(tpp);

            const tdOp=document.createElement("td");
            tdOp.textContent=type==="consume"?"消耗":"补充";
            tdOp.className=type==="consume"?"op-consume":"op-restock";

            const tdQty=document.createElement("td");
            tdQty.textContent=qty;

            const tdPattern=document.createElement("td");
            if(source==="manual"){
              tdPattern.textContent="";
            }else{
              tdPattern.textContent=type==="consume"?(pattern||""):"";
            }

            tr.appendChild(tdTime);
            tr.appendChild(tdOp);
            tr.appendChild(tdQty);
            tr.appendChild(tdPattern);
            tbody.appendChild(tr);
          });

        }
        openDialog(detailDialog);
      }catch{
        toast("加载明细失败","error");
      }
    }

    // CSV
    // 兼容多种 CSV 编码（UTF-8 / UTF-16 / GB18030 等），自动挑选最“像CSV”的解码结果
    function _scoreCsvText(t){
      if(!t) return -999999;
      const s=String(t).replace(/\u0000/g,"");
      let score=0;
      const rep=(s.match(/\uFFFD/g)||[]).length; // replacement char
      score -= rep*2;
      if(/[色号色號]/.test(s)) score += 30;
      if(/CODE|QTY/i.test(s)) score += 10;

      const lines=s.split(/\r?\n/).slice(0,30);
      let good=0;
      for(const line0 of lines){
        const line=String(line0||"").trim();
        if(!line) continue;
        if(/^sep\s*=/.test(line.toLowerCase())){ score += 5; continue; }
        const parts=line.split(/,|\t|;|，|；/);
        if(parts.length>=2){
          const c=String(parts[0]||"").trim().replace(/^["']|["']$/g,"").toUpperCase();
          if(/^[A-Z]\d{1,2}$/.test(c)) good+=1;
        }
      }
      score += good*15;
      return score;
    }

    function _decodeArrayBufferAuto(buf){
      try{
        const u8 = new Uint8Array(buf);

        // BOM 快速路径
        if(u8.length>=3 && u8[0]===0xEF && u8[1]===0xBB && u8[2]===0xBF){
          return new TextDecoder("utf-8",{fatal:false}).decode(buf);
        }
        if(u8.length>=2 && u8[0]===0xFF && u8[1]===0xFE){
          return new TextDecoder("utf-16le",{fatal:false}).decode(buf);
        }
        if(u8.length>=2 && u8[0]===0xFE && u8[1]===0xFF){
          return new TextDecoder("utf-16be",{fatal:false}).decode(buf);
        }

        // 候选编码（Chrome 通常支持 gb18030；gbk/big5/shift_jis 可能因环境而异）
        const encs=["utf-8","gb18030","utf-16le","utf-16be","gbk","big5","shift_jis"];
        let best=null, bestScore=-999999;
        for(const enc of encs){
          try{
            const txt=new TextDecoder(enc,{fatal:false}).decode(buf);
            const sc=_scoreCsvText(txt);
            if(sc>bestScore){ bestScore=sc; best=txt; }
          }catch{}
        }
        if(best!==null) return best;
        return new TextDecoder("utf-8",{fatal:false}).decode(buf);
      }catch{
        // TextDecoder 不可用（极少数环境）：退回到 UTF-8
        try{
          return String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)));
        }catch{
          return "";
        }
      }
    }

    function normalizeCsvText(text){
      return String(text||"")
        .replace(/\u0000/g,"")
        .replace(/^\uFEFF/,"")
        .replace(/^\s*sep\s*=\s*[,;\t]\s*\r?\n/i,"")
        .trim();
    }
    function parseCsv(text){
      const cleaned=normalizeCsvText(text);
      if(!cleaned) return [];
      const lines=cleaned.split(/\r?\n/).filter(l=>l.trim()!=="");
      const rows=[];
      for(let idx=0; idx<lines.length; idx++){
        const line = lines[idx];
        if(idx===0 && /^sep\s*=/.test(String(line||"").trim().toLowerCase())) continue;
        const parts=line.split(/,|\t|;|，|；/).map(p=>String(p||"").trim().replace(/^["']|["']$/g,""));
        if(parts.length<2) throw new Error("bad format");
        const rawCode = (parts[0]||"").trim();
        let rawQty  = (parts[1]||"").trim();
        const code = rawCode.toUpperCase();

        // 兼容：有些导出/模板会是「色号,颜色,数量」或「色号,HEX,数量」——数量不一定在第二列
        let qtyNum = Number(rawQty);
        if(!Number.isFinite(qtyNum) && parts.length>2){
          for(let i=2;i<parts.length;i++){
            const cand = String(parts[i]||"").trim().replace(/^["']|["']$/g,"");
            const n = Number(cand);
            if(Number.isFinite(n)){ rawQty=cand; qtyNum=n; break; }
          }
        }

        // 兼容首行中文/英文表头（例如：色号,数量 / 色号,消耗数量 / CODE,QTY 等）
        // - 规则：首行且“看起来不像色号”并且数量列也不是数字 => 当作表头跳过
        const looksLikeCode = /^[A-Z]\d{1,2}$/.test(code);
        const qtyIsNumber = Number.isFinite(qtyNum);
        const headerHints = ["色号","色號","CODE","编号","編號","颜色","顏色","数量","數量","QTY","消耗","补充","補充"];
        const hasHeaderHint = headerHints.some(h => rawCode.includes(h) || rawQty.includes(h) || code.includes(h));
        if(idx===0 && (!looksLikeCode) && (!qtyIsNumber) && hasHeaderHint) continue;

        // 兼容部分文件把表头写在第一列（或多余空格/BOM）
        if(code==="色号"||code==="色號"||code==="CODE") continue;

        if(!COLORS[code]) throw new Error("unknown code");
        if(!qtyIsNumber || !Number.isInteger(qtyNum)) throw new Error("bad qty");
        if(qtyNum<0) throw new Error("bad qty");
        if(qtyNum===0) continue;
        rows.push({code,qty: qtyNum});
      }
      return rows;
    }
    function readFileText(file){
      return new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>{
          try{
            resolve(_decodeArrayBufferAuto(reader.result));
          }catch(e){
            reject(e);
          }
        };
        reader.onerror=()=>reject(reader.error||new Error("read error"));
        reader.readAsArrayBuffer(file);
      });
    }
    // tabs
    const consumeTabsState={active:"consume-manual"};
    const restockTabsState={active:"restock-manual"};

    function initSimpleTabs(rootId,state){
      const root=document.getElementById(rootId);
      if(!root) return;
      const btns=Array.from(root.querySelectorAll(".tab-nav .tab-btn"));
      const panels={
        "consume-manual":document.getElementById("consumeManualPanel"),
        "consume-batch":document.getElementById("consumeBatchPanel"),
        "consume-ai":document.getElementById("consumeAiPanel"),
        "restock-manual":document.getElementById("restockManualPanel"),
        "restock-batch":document.getElementById("restockBatchPanel"),
        "restock-bulk":document.getElementById("restockBulkPanel"),
      };
      function setActive(tab){
        state.active=tab;
        btns.forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
        Object.keys(panels).forEach(k=>{
          if(panels[k]) panels[k].classList.toggle("active",k===tab);
        });
      }
      btns.forEach(b=>b.addEventListener("click",()=>setActive(b.dataset.tab)));
      setActive(state.active);
    }

    // 手动记录行 & 删除按钮逻辑
    function updateManualRowDeleteButtons(container){
      const rows=container.querySelectorAll(".record-row");
      rows.forEach(row=>{
        const btn=row.querySelector("button");
        if(!btn) return;
        btn.style.visibility=rows.length<=1?"hidden":"visible";
      });
    }
    function createManualRow(container,onChange){
      const row=document.createElement("div");
      row.className="record-row";
      const codeInput=document.createElement("input");
      codeInput.type="text";
      codeInput.placeholder="色号";
      codeInput.maxLength=10;
      const qtyInput=document.createElement("input");
      qtyInput.type="number";
      qtyInput.placeholder="数量";
      qtyInput.min="1";qtyInput.step="1";
      const removeBtn=document.createElement("button");
      removeBtn.type="button";
      removeBtn.textContent="删除";
      removeBtn.addEventListener("click",()=>{
        const rows=container.querySelectorAll(".record-row");
        if(rows.length<=1){
          toast("至少保留一条记录","error");
          return;
        }
        row.remove();
        updateManualRowDeleteButtons(container);
        if(onChange) onChange();
      });
      codeInput.addEventListener("input",()=>onChange&&onChange());
      qtyInput.addEventListener("input",()=>onChange&&onChange());
      row.appendChild(codeInput);
      row.appendChild(qtyInput);
      row.appendChild(removeBtn);
      container.appendChild(row);
      updateManualRowDeleteButtons(container);
      if(onChange) onChange();
      return row;
    }

    // 消耗-手动统计
    function updateConsumeManualSummary(){
      const container=document.getElementById("consumeManualRows");
      const rows=Array.from(container.querySelectorAll(".record-row"));
      const codes=new Set();
      let total=0;
      for(const row of rows){
        const [codeInput,qtyInput]=row.querySelectorAll("input");
        const code=(codeInput.value||"").trim().toUpperCase();
        const qtyRaw=(qtyInput.value||"").trim();
        if(code) codes.add(code);
        const q=Number(qtyRaw);
        if(Number.isInteger(q)&&q>0) total+=q;
      }
      const summary=document.getElementById("consumeManualSummary");
      if(summary) summary.textContent=`已填写色号：${codes.size} 个 · 拼豆合计：${total} 粒`;
    }

    function updateImageInputLabel(input, labelEl){
      if(!input || !labelEl) return;
      const file = input.files?.[0];
      if(!file){
        labelEl.textContent = "未选择图纸";
        return;
      }
      if(!isAllowedImageFile(file)){
        toast("仅支持 JPG/PNG/WebP 图片","error");
        input.value = "";
        labelEl.textContent = "未选择图纸";
        return;
      }
      labelEl.textContent = file.name || "已选择图纸";
    }

    async function maybeUploadPatternImage(file){
      if(!file) return null;
      return await uploadPatternImage(file);
    }

    // 记录消耗
    const consumeDialog=document.getElementById("consumeDialog");
    const consumeManualPatternInput=document.getElementById("consumeManualPattern");
    const consumeManualCategorySelect=document.getElementById("consumeManualCategory");
    const consumeManualRows=document.getElementById("consumeManualRows");
    const consumeManualImageInput=document.getElementById("consumeManualImage");
    const consumeManualImageName=document.getElementById("consumeManualImageName");
    const consumeFileInput=document.getElementById("consumeFile");
    const consumeFileName=document.getElementById("consumeFileName");
    const consumeBatchPatternInput=document.getElementById("consumeBatchPattern");
    const consumeBatchCategorySelect=document.getElementById("consumeBatchCategory");
    const consumeBatchImageInput=document.getElementById("consumeBatchImage");
    const consumeBatchImageName=document.getElementById("consumeBatchImageName");

    // 图纸识别（AI）
    const consumeAiPatternInput=document.getElementById("consumeAiPattern");
    const consumeAiCategorySelect=document.getElementById("consumeAiCategory");
    const consumeAiImageInput=document.getElementById("consumeAiImage");
    const consumeAiImageName=document.getElementById("consumeAiImageName");
    const consumeAiRecognizeBtn=document.getElementById("consumeAiRecognize");
    const consumeAiClearBtn=document.getElementById("consumeAiClear");
    const consumeAiResultWrap=document.getElementById("consumeAiResultWrap");
    const consumeAiTbody=document.getElementById("consumeAiTableBody");
    const consumeAiEmpty=document.getElementById("consumeAiEmpty");
    const consumeAiSummary=document.getElementById("consumeAiSummary");
    const consumeAiUnknown=document.getElementById("consumeAiUnknown");
    const consumeAiAddRowBtn=document.getElementById("consumeAiAddRow");
    let consumeAiRecognizedFile = null;

    function aiClearResult(){
      consumeAiTbody.innerHTML="";
      consumeAiResultWrap.style.display="none";
      consumeAiEmpty.style.display="none";
      consumeAiRecognizedFile = null;
      // AI 结果相关按钮：仅在有结果时展示
      consumeAiClearBtn.style.display="none";
      consumeAiAddRowBtn.style.display="none";
      if(consumeAiSummary) consumeAiSummary.textContent="已识别色号：0 个 · 拼豆合计：0 粒";
      if(consumeAiUnknown) consumeAiUnknown.textContent="";
    }

    function aiRecalcSummary(){
      const rows=Array.from(consumeAiTbody.querySelectorAll("tr"));
      const codes=new Set();
      let total=0;
      const unknown=[];
      rows.forEach(tr=>{
        const code=(tr.querySelector('input[data-k="code"]')?.value||"").trim().toUpperCase();
        const qty=Number((tr.querySelector('input[data-k="qty"]')?.value||"").trim());
        if(code) codes.add(code);
        if(Number.isInteger(qty) && qty>0) total+=qty;
        if(code && !COLORS[code]) unknown.push(code);
      });
      if(consumeAiSummary) consumeAiSummary.textContent=`已识别色号：${codes.size} 个 · 拼豆合计：${total} 粒`;
      const uniqUnknown=Array.from(new Set(unknown)).sort(sortCodes);
      if(consumeAiUnknown){
        consumeAiUnknown.textContent = uniqUnknown.length
          ? `提示：以下色号不在你的色号库中（请先在“设置-添加色号”中补齐，或修改识别结果）：${uniqUnknown.join(", ")}`
          : "";
      }
    }

    function aiAddRow(item){
      const tr=document.createElement("tr");
      const codeTd=document.createElement("td");
      const qtyTd=document.createElement("td");
      const confTd=document.createElement("td");
      confTd.className="ai-conf-td";
      const opTd=document.createElement("td");

      const codeInput=document.createElement("input");
      codeInput.type="text";
      codeInput.value=(item.code||"").toUpperCase();
      codeInput.placeholder="色号";
      codeInput.maxLength=10;
      codeInput.dataset.k="code";

      const qtyInput=document.createElement("input");
      qtyInput.type="number";
      qtyInput.value=Number.isFinite(item.qty)?String(item.qty):"";
      qtyInput.placeholder="数量";
      qtyInput.min="1"; qtyInput.step="1";
      qtyInput.dataset.k="qty";

      const confSpan=document.createElement("span");
      confSpan.className="ai-conf";
      const isManual = !!item._manual;
      const conf = (()=>{ const v=item.confidence; if(v===null||v===undefined||v==="") return null; const n=Number(v); return Number.isFinite(n)? n : null; })();
      confSpan.textContent = isManual ? "" : (conf===null ? "-" : String(Math.round(conf*100)/100));

      const delBtn=document.createElement("button");
      delBtn.type="button";
      delBtn.textContent="删除";
      delBtn.addEventListener("click",()=>{
        tr.remove();
        if(consumeAiTbody.children.length===0){
          consumeAiEmpty.style.display="block";
        }
        aiRecalcSummary();
      });

      [codeInput, qtyInput].forEach(inp=>inp.addEventListener("input",()=>{
        // unknown highlighting
        const code=(codeInput.value||"").trim().toUpperCase();
        tr.classList.toggle("ai-row-unknown", !!(code && !COLORS[code]));
        aiRecalcSummary();
      }));

      codeTd.appendChild(codeInput);
      qtyTd.appendChild(qtyInput);
      confTd.appendChild(confSpan);
      opTd.appendChild(delBtn);

      tr.appendChild(codeTd);
      tr.appendChild(qtyTd);
      tr.appendChild(confTd);
      tr.appendChild(opTd);

      consumeAiTbody.appendChild(tr);

      const code=(codeInput.value||"").trim().toUpperCase();
      tr.classList.toggle("ai-row-unknown", !!(code && !COLORS[code]));
    }

    async function aiRecognize(){
      if(!IS_LOGGED_IN){ toast("请登录后使用AI功能","warn"); return; }
      const pattern=(consumeAiPatternInput.value||"").trim();
      if(pattern.length>20){
        toast("图纸名称不超过 20 字","error");
        return;
      }
      const file=consumeAiImageInput.files?.[0];
      if(!file){
        toast("请先选择图纸图片","error");
        return;
      }
      if(!isAllowedImageFile(file)){
        toast("仅支持 JPG/PNG/WebP 图片","error");
        return;
      }
      consumeAiRecognizedFile = null;

      consumeAiRecognizeBtn.disabled=true;
      const oldText=consumeAiRecognizeBtn.textContent;
      consumeAiRecognizeBtn.textContent="识别中…";
      showGlobalLoading("AI识别中，请稍候…");

      try{
        const fd=new FormData();
        fd.append("image", file);
        fd.append("pattern", pattern);

        // 说明：真正的模型调用在服务端完成；前端只调用你自己的接口
        const res=await apiPostForm("/api/recognize-pattern", fd);

        const items = Array.isArray(res.items) ? res.items
                   : Array.isArray(res.data) ? res.data
                   : Array.isArray(res?.result?.items) ? res.result.items
                   : [];

        // 清空并渲染
        consumeAiTbody.innerHTML="";
        // AI 已返回结果后才展示清空/添加按钮
        consumeAiClearBtn.style.display="inline-flex";
        consumeAiAddRowBtn.style.display="inline-flex";
        if(items.length===0){
          consumeAiResultWrap.style.display="block";
          consumeAiEmpty.style.display="block";
          if(consumeAiUnknown) consumeAiUnknown.textContent="";
          if(consumeAiSummary) consumeAiSummary.textContent="已识别色号：0 个 · 拼豆合计：0 粒";
          toast("未识别到有效色号，请换一张更清晰的图片","error");
          return;
        }

        // 规整 & 合并同色号
        const map=new Map();
        for(const it of items){
          const code=(it.code||"").trim().toUpperCase();
          const qty=Number(it.qty);
          if(!/^([A-Z])(\d{1,2})$/.test(code)) continue;
          if(!Number.isInteger(qty) || qty<=0) continue;
          const conf = (()=>{ const v=it.confidence; if(v===null||v===undefined||v==="") return null; const n=Number(v); return Number.isFinite(n)? n : null; })();
          if(!map.has(code)) map.set(code,{code,qty,confidence:conf});
          else{
            const prev=map.get(code);
            prev.qty += qty;
            // 置信度取较低者，保守一点
            if(prev.confidence===null) prev.confidence = conf;
            else if(conf!==null) prev.confidence = Math.min(prev.confidence, conf);
          }
        }
        const merged = Array.from(map.values()).sort((a,b)=>sortCodes(a.code,b.code));

        consumeAiResultWrap.style.display="block";
        consumeAiEmpty.style.display = merged.length ? "none" : "block";

        merged.forEach(it=>aiAddRow(it));
        aiRecalcSummary();
        consumeAiRecognizedFile = file;
        toast("识别完成，请核对后点击「确认记录」","success");
      }catch(e){
        toast(e.message || "识别失败，请检查服务端接口","error");
      }finally{
        consumeAiRecognizeBtn.disabled=false;
        consumeAiRecognizeBtn.textContent=oldText;
        hideGlobalLoading();
      }
    }


    document.getElementById("btnConsume").addEventListener("click",()=>{
      consumeManualPatternInput.value="";
      if(consumeManualCategorySelect) consumeManualCategorySelect.value="";
      if(consumeManualImageInput) consumeManualImageInput.value="";
      if(consumeManualImageName) consumeManualImageName.textContent="未选择图纸";
      if(consumeBatchPatternInput) consumeBatchPatternInput.value="";
      if(consumeBatchCategorySelect) consumeBatchCategorySelect.value="";
      if(consumeBatchImageInput) consumeBatchImageInput.value="";
      if(consumeBatchImageName) consumeBatchImageName.textContent="未选择图纸";
      if(consumeFileInput) consumeFileInput.value="";
      if(consumeFileName) consumeFileName.textContent="未选择文件";
      // AI reset
      consumeAiPatternInput.value="";
      if(consumeAiCategorySelect) consumeAiCategorySelect.value="";
      consumeAiImageInput.value="";
      consumeAiImageName.textContent="未选择图纸";
      consumeAiRecognizedFile = null;
      aiClearResult();
      consumeManualRows.innerHTML="";
      for(let i=0;i<3;i++) createManualRow(consumeManualRows,updateConsumeManualSummary);
      consumeTabsState.active="consume-ai";
      initSimpleTabs("consumeTabs",consumeTabsState);
      updateConsumeManualSummary();
      showPage("consume", {scrollTop:true, smooth:true});
    });
    document.getElementById("consumeClose").addEventListener("click",()=>showPage("records", {scrollTop:true, smooth:true}));
    document.getElementById("consumeAddRow").addEventListener("click",()=>{
      const rows=consumeManualRows.querySelectorAll(".record-row");
      if(rows.length>=100){
        toast("一次最多添加 100 条记录","error");
        return;
      }
      createManualRow(consumeManualRows,updateConsumeManualSummary);
    });
    consumeManualImageInput?.addEventListener("change",()=>{
      updateImageInputLabel(consumeManualImageInput, consumeManualImageName);
    });
    consumeBatchImageInput?.addEventListener("change",()=>{
      updateImageInputLabel(consumeBatchImageInput, consumeBatchImageName);
    });
    consumeAiImageInput.addEventListener("change",()=>{
      updateImageInputLabel(consumeAiImageInput, consumeAiImageName);
      consumeAiRecognizedFile = null;
    });
    consumeFileInput?.addEventListener("change",()=>{
      if(consumeFileName) consumeFileName.textContent=consumeFileInput.files[0]?.name||"未选择文件";
    });
    consumeAiRecognizeBtn.addEventListener("click", aiRecognize);
    consumeAiClearBtn.addEventListener("click", ()=>{ aiClearResult(); toast("已清空识别结果","success"); });
    consumeAiAddRowBtn.addEventListener("click",()=>{
      // 允许用户在识别结果中手动补充/新增记录（置信度为空）
      const current=consumeAiTbody.querySelectorAll("tr").length;
      if(current>=100){toast("一次最多添加 100 条记录","error");return;}
      consumeAiResultWrap.style.display="block";
      consumeAiEmpty.style.display="none";
      aiAddRow({code:"",qty:NaN,confidence:null,_manual:true});
      aiRecalcSummary();
    });

    const consumeConfirmBtn = document.getElementById("consumeConfirm");
    consumeConfirmBtn.addEventListener("click",async()=>{
      if(consumeConfirmBtn.disabled) return;
      consumeConfirmBtn.disabled = true;
      const reqId = newRequestId();
      try{
        if(consumeTabsState.active==="consume-manual"){
          const rows=Array.from(consumeManualRows.querySelectorAll(".record-row"));
          if(rows.length===0){toast("请至少添加一条记录","error");return;}
          const pattern=consumeManualPatternInput.value.trim();
          if(pattern.length>20){toast("图纸名称不超过 20 字","error");return;}
          const patternCategoryId = (consumeManualCategorySelect?.value || "").trim() || null;
          const items=[];
          for(const row of rows){
            const inputs=row.querySelectorAll("input");
            const code=(inputs[0].value||"").trim().toUpperCase();
            const qtyStr=(inputs[1].value||"").trim();

            // 允许默认的空行：色号和数量都为空则忽略
            if(!code && !qtyStr) continue;

            // 只填了其中一个则报错
            if(!code || !COLORS[code]){
              toast("存在空的色号或无效色号","error");return;
            }
            const qty=Number(qtyStr);
            if(!Number.isInteger(qty) || qty<=0){
              toast("存在无效数量（必须为正整数）","error");return;
            }
            items.push({code,qty});
          }
          if(items.length===0){toast("请至少添加一条记录","error");return;}

          let patternUpload = null;
          const manualImageFile = consumeManualImageInput?.files?.[0];
          if(manualImageFile){
            patternUpload = await maybeUploadPatternImage(manualImageFile);
          }

          const payload = {
            items: items.map(item=>({
              code:item.code,
              type:"consume",
              qty:item.qty,
              pattern:pattern||null,
              source:"form"
            }))
          };
          if(patternCategoryId) payload.patternCategoryId = patternCategoryId;
          if(patternUpload?.cdnUrl) payload.patternUrl = patternUpload.cdnUrl;
          if(patternUpload?.objectKey) payload.patternKey = patternUpload.objectKey;

          await apiPost("/api/adjustBatch", payload, {headers:{"x-idempotency-key": reqId}});

          await syncAll();
          showPage("records", {scrollTop:true, smooth:true});
          toast("记录成功","success");

        }else if(consumeTabsState.active==="consume-batch"){
          const pattern=(consumeBatchPatternInput?.value || "").trim();
          if(pattern.length>20){toast("图纸名称不超过 20 字","error");return;}
          const patternCategoryId = (consumeBatchCategorySelect?.value || "").trim() || null;
          const file=consumeFileInput?.files?.[0];
          if(!file){toast("请先选择 CSV 文件","error");return;}
          const text=await readFileText(file);
          const rows=parseCsv(text);
          if(rows.length===0) throw new Error("empty");

          let patternUpload = null;
          const batchImageFile = consumeBatchImageInput?.files?.[0];
          if(batchImageFile){
            patternUpload = await maybeUploadPatternImage(batchImageFile);
          }

          const payload = {
            items: rows.map(r=>({
              code:r.code,
              type:"consume",
              qty:r.qty,
              pattern: pattern || null,
              source:"csv"
            }))
          };
          if(patternCategoryId) payload.patternCategoryId = patternCategoryId;
          if(patternUpload?.cdnUrl) payload.patternUrl = patternUpload.cdnUrl;
          if(patternUpload?.objectKey) payload.patternKey = patternUpload.objectKey;

          await apiPost("/api/adjustBatch", payload, {headers:{"x-idempotency-key": reqId}});

          await syncAll();
          showPage("records", {scrollTop:true, smooth:true});
          toast("记录成功","success");

        }else if(consumeTabsState.active==="consume-ai"){
          const pattern=consumeAiPatternInput.value.trim();
          if(pattern.length>20){toast("图纸名称不超过 20 字","error");return;}
          const patternCategoryId = (consumeAiCategorySelect?.value || "").trim() || null;
          const rows=Array.from(consumeAiTbody.querySelectorAll("tr"));
          if(rows.length===0){toast("请先识别图片，或手动补充识别结果","error");return;}
          const items=[];
          for(const tr of rows){
            const code=(tr.querySelector('input[data-k="code"]')?.value||"").trim().toUpperCase();
            const qty=Number((tr.querySelector('input[data-k="qty"]')?.value||"").trim());
            if(!code || !COLORS[code]){toast("存在无效色号（请先添加色号或修改识别结果）","error");return;}
            if(!Number.isInteger(qty) || qty<=0){toast("存在无效数量（必须为正整数）","error");return;}
            items.push({code,qty});
          }

          let patternUpload = null;
          const aiImageFile = consumeAiRecognizedFile || consumeAiImageInput?.files?.[0];
          if(aiImageFile){
            patternUpload = await maybeUploadPatternImage(aiImageFile);
          }

          const payload = {
            items: items.map(item=>({
              code:item.code,
              type:"consume",
              qty:item.qty,
              pattern:pattern||null,
              source:"image"
            }))
          };
          if(patternCategoryId) payload.patternCategoryId = patternCategoryId;
          if(patternUpload?.cdnUrl) payload.patternUrl = patternUpload.cdnUrl;
          if(patternUpload?.objectKey) payload.patternKey = patternUpload.objectKey;

          await apiPost("/api/adjustBatch", payload, {headers:{"x-idempotency-key": reqId}});

          await syncAll();
          showPage("records", {scrollTop:true, smooth:true});
          toast("记录成功","success");

        }
      }catch(e){
        const msg = e?.message ? String(e.message) : "";
        if(e && e.httpStatus===400 && msg){
          toast(msg,"error");
        }else if(msg && msg !== "empty"){
          toast(msg,"error");
        }else{
          toast("文件内容格式错误或记录失败","error");
        }
      } finally {
        consumeConfirmBtn.disabled = false;
      }
    });

    // 补充
    const restockDialog=document.getElementById("restockDialog");
    const restockManualRows=document.getElementById("restockManualRows");
    const restockFileInput=document.getElementById("restockFile");
    const restockFileName=document.getElementById("restockFileName");
    const restockBulkGrid=document.getElementById("restockBulkGrid");
    const restockBulkMeta=document.getElementById("restockBulkMeta");
    const restockBulkAddAll=document.getElementById("restockBulkAddAll");
    let restockBulkInputs=[];

    function buildRestockBulkGrid(){
      if(!restockBulkGrid) return;

      // 批量记录：仅展示“已添加到库存”的色号（即当前 INVENTORY 中存在的色号）
      // 未登录（游客）模式下，INVENTORY 本身就包含全部色号，因此仍会展示全部
      const codes = Object.keys(INVENTORY||{}).sort(sortCodes);
      const list = (codes && codes.length>0) ? codes : MASTER_CODES.slice();

      restockBulkGrid.innerHTML="";
      restockBulkInputs=[];
      list.forEach(code=>{
        const item=document.createElement("div");
        item.className="bulk-item";
        item.innerHTML = `
          <div class="code">${code}</div>
          <input type="number" inputmode="numeric" min="0" step="1" data-code="${code}">
        `;
        const inp=item.querySelector("input");
        inp.addEventListener("input",updateRestockBulkMeta);
        restockBulkInputs.push(inp);
        restockBulkGrid.appendChild(item);
      });
      updateRestockBulkMeta();
    }

    function resetRestockBulkInputs(){
      buildRestockBulkGrid();
      restockBulkInputs.forEach(i=>{ i.value=""; });
      updateRestockBulkMeta();
    }

    function updateRestockBulkMeta(){
      if(!restockBulkMeta) return;
      let filled=0,total=0;
      restockBulkInputs.forEach(i=>{
        const v=(i.value||"").trim();
        if(v==="") return;
        const n=Number(v);
        if(Number.isFinite(n) && n>0){
          filled+=1;
          total+=Math.floor(n);
        }
      });
      restockBulkMeta.textContent = `已填写色号：${filled}个 · 拼豆合计：${total}粒`;
    }

    restockBulkAddAll?.addEventListener("click",()=>{
      if(!restockBulkInputs || restockBulkInputs.length===0) buildRestockBulkGrid();
      const raw = window.prompt("请输入要添加到全部色号的数量（正整数）","");
      if(raw===null) return;
      const n = Number(String(raw).trim());
      if(!Number.isInteger(n) || n<=0){ toast("请输入正整数","error"); return; }
      restockBulkInputs.forEach(i=>{
        const cur = Number((i.value||"").trim()||0);
        const next = (Number.isFinite(cur)?cur:0) + n;
        i.value = String(next);
      });
      updateRestockBulkMeta();
    });



    document.getElementById("btnRestock").addEventListener("click",()=>{
      restockFileInput.value="";
      restockFileName.textContent="未选择文件";
      restockManualRows.innerHTML="";
      for(let i=0;i<3;i++) createManualRow(restockManualRows);
      resetRestockBulkInputs();
      restockTabsState.active="restock-manual";
      initSimpleTabs("restockTabs",restockTabsState);
      showPage("restock", {scrollTop:true, smooth:true});
    });
    document.getElementById("restockClose").addEventListener("click",()=>showPage("records", {scrollTop:true, smooth:true}));
    document.getElementById("restockAddRow").addEventListener("click",()=>{
      const rows=restockManualRows.querySelectorAll(".record-row");
      if(rows.length>=100){toast("一次最多添加 100 条记录","error");return;}
      createManualRow(restockManualRows);
    });
    restockFileInput.addEventListener("change",()=>{
      restockFileName.textContent=restockFileInput.files[0]?.name||"未选择文件";
    });
    const restockConfirmBtn = document.getElementById("restockConfirm");
    restockConfirmBtn.addEventListener("click",async()=>{
      if(restockConfirmBtn.disabled) return;
      restockConfirmBtn.disabled = true;
      const reqId = newRequestId();
      try{
        if(restockTabsState.active==="restock-manual"){
          const rows=Array.from(restockManualRows.querySelectorAll(".record-row"));
          if(rows.length===0){toast("请至少添加一条记录","error");return;}
          const items=[];
          for(const row of rows){
            const inputs=row.querySelectorAll("input");
            const code=(inputs[0].value||"").trim().toUpperCase();
            const qtyStr=(inputs[1].value||"").trim();

            // 允许默认的空行：色号和数量都为空则忽略
            if(!code && !qtyStr) continue;

            // 只填了其中一个则报错
            if(!code || !COLORS[code]){toast("存在空的色号或无效色号","error");return;}
            const qty=Number(qtyStr);
            if(!Number.isInteger(qty) || qty<=0){toast("存在无效数量（必须为正整数）","error");return;}
            items.push({code,qty});
          }
          if(items.length===0){toast("请至少添加一条记录","error");return;}

          await apiPost("/api/adjustBatch",{
            items: items.map(item=>({
              code:item.code,
              type:"restock",
              qty:item.qty,
              source:"form"
            }))
          },{headers:{"x-idempotency-key": reqId}});

          await syncAll();
          showPage("records", {scrollTop:true, smooth:true});
          toast("记录成功","success");

        }else if(restockTabsState.active==="restock-bulk"){
          if(!restockBulkInputs || restockBulkInputs.length===0) buildRestockBulkGrid();
          const items=[];
          for(const inp of restockBulkInputs){
            const code=(inp.dataset.code||"").trim().toUpperCase();
            const qtyStr=(inp.value||"").trim();
            if(!qtyStr) continue;
            const qty=Number(qtyStr);
            if(!Number.isInteger(qty) || qty<=0){toast("存在无效数量（必须为正整数）","error");return;}
            items.push({code,qty});
          }
          if(items.length===0){toast("未填写任何数量","warn");return;}

          await apiPost("/api/adjustBatch",{
            items: items.map(item=>({
              code:item.code,
              type:"restock",
              qty:item.qty,
              source:"bulk"
            }))
          },{headers:{"x-idempotency-key": reqId}});

          await syncAll();
          showPage("records", {scrollTop:true, smooth:true});
          toast("记录成功","success");

        }else{
          const file=restockFileInput.files[0];
          if(!file){toast("请先选择 CSV 文件","error");return;}
          const text=await readFileText(file);
          const rows=parseCsv(text);
          if(rows.length===0) throw new Error("empty");

          await apiPost("/api/adjustBatch",{
            items: rows.map(r=>({
              code:r.code,
              type:"restock",
              qty:r.qty,
              source:"csv"
            }))
          },{headers:{"x-idempotency-key": reqId}});

          await syncAll();
          showPage("records", {scrollTop:true, smooth:true});
          toast("记录成功","success");
        }
      }catch{
        toast("文件内容格式错误或记录失败","error");
      } finally {
        restockConfirmBtn.disabled = false;
      }
    });

    // 图纸消耗计算
    const patternCalcImageInput=document.getElementById("patternCalcImage");
    const patternCalcImageName=document.getElementById("patternCalcImageName");
    const patternCalcRecognizeBtn=document.getElementById("patternCalcRecognize");
    const patternCalcClearBtn=document.getElementById("patternCalcClear");
    const patternCalcAddTodoBtn=document.getElementById("patternCalcAddTodo");
    const patternCalcResultWrap=document.getElementById("patternCalcResultWrap");
    const patternCalcList=document.getElementById("patternCalcList");
    const patternCalcEmpty=document.getElementById("patternCalcEmpty");
    const patternCalcTotalChip=document.getElementById("patternCalcTotalChip");
    const patternCalcCountChip=document.getElementById("patternCalcCountChip");
    const patternCalcShortChip=document.getElementById("patternCalcShortChip");
    const patternCalcUnknown=document.getElementById("patternCalcUnknown");
    const patternCalcTodoEntry=document.getElementById("patternCalcTodoEntry");
    let patternCalcMergedMap=new Map();
    let patternCalcLastImageFile=null;

    function resetPatternCalcUploader(){
      if(patternCalcImageInput) patternCalcImageInput.value="";
      if(patternCalcImageName) patternCalcImageName.textContent="未选择图纸";
    }

    function updatePatternCalcButton(){
      if(!patternCalcRecognizeBtn) return;
      patternCalcRecognizeBtn.textContent = patternCalcMergedMap.size ? "补充计算" : "开始计算";
    }

    function clearPatternCalcResult(){
      patternCalcMergedMap.clear();
      if(patternCalcList) patternCalcList.innerHTML="";
      if(patternCalcResultWrap) patternCalcResultWrap.style.display="none";
      if(patternCalcEmpty) patternCalcEmpty.style.display="none";
      if(patternCalcClearBtn) patternCalcClearBtn.style.display="none";
      if(patternCalcAddTodoBtn) patternCalcAddTodoBtn.style.display="none";
      if(patternCalcTotalChip) patternCalcTotalChip.textContent="总消耗：0";
      if(patternCalcCountChip) patternCalcCountChip.textContent="色号：0";
      if(patternCalcShortChip) patternCalcShortChip.textContent="不足：0";
      if(patternCalcUnknown) patternCalcUnknown.textContent="";
      patternCalcLastImageFile = null;
      updatePatternCalcButton();
      resetPatternCalcUploader();
    }

    function normalizePatternCalcItems(items){
      const map=new Map();
      for(const it of (items||[])){
        const code=String(it?.code||"").trim().toUpperCase();
        const qty=Number(it?.qty);
        if(!/^([A-Z])(\d{1,2})$/.test(code)) continue;
        if(!Number.isInteger(qty) || qty<=0) continue;
        if(!map.has(code)) map.set(code,{code,qty});
        else map.get(code).qty += qty;
      }
      return Array.from(map.values());
    }

    function mergePatternCalcItems(items){
      for(const it of (items||[])){
        const code=String(it?.code||"").trim().toUpperCase();
        const qty=Number(it?.qty);
        if(!code || !Number.isFinite(qty)) continue;
        if(!patternCalcMergedMap.has(code)) patternCalcMergedMap.set(code,{code,qty});
        else patternCalcMergedMap.get(code).qty += qty;
      }
      return Array.from(patternCalcMergedMap.values());
    }

    function renderPatternCalc(items){
      if(!patternCalcList) return;
      const rows=(items||[]).map(it=>{
        const code=it.code;
        const qty=Number(it.qty)||0;
        const inventory=Number(INVENTORY?.[code] ?? 0) || 0;
        const remain=inventory - qty;
        const hex=COLORS[code] || MASTER_HEX[code] || "#777777";
        return {code,qty,inventory,remain,hex};
      }).sort((a,b)=> (b.qty - a.qty) || sortCodes(a.code,b.code));

      patternCalcList.innerHTML="";

      const total=rows.reduce((acc,it)=> acc + (Number(it.qty)||0), 0);
      const shortage=rows.filter(it=>it.remain<0).length;

      if(patternCalcTotalChip) patternCalcTotalChip.textContent=`总消耗：${total}`;
      if(patternCalcCountChip) patternCalcCountChip.textContent=`色号：${rows.length}`;
      if(patternCalcShortChip) patternCalcShortChip.textContent=`不足：${shortage}`;

      if(patternCalcResultWrap) patternCalcResultWrap.style.display="block";
      if(patternCalcClearBtn) patternCalcClearBtn.style.display="inline-flex";
      if(patternCalcAddTodoBtn) patternCalcAddTodoBtn.style.display = rows.length ? "inline-flex" : "none";
      if(patternCalcEmpty) patternCalcEmpty.style.display=rows.length ? "none" : "block";

      const unknown=rows.filter(it=>!COLORS[it.code]).map(it=>it.code);
      if(patternCalcUnknown){
        const uniq=Array.from(new Set(unknown)).sort(sortCodes);
        patternCalcUnknown.textContent = uniq.length
          ? `提示：以下色号不在你的色号库中（当前库存按 0 计算）：${uniq.join(", ")}`
          : "";
      }

      if(rows.length===0) return;

      rows.forEach(it=>{
        const row=document.createElement("div");
        row.className="calc-row";

        const cCode=document.createElement("div");
        cCode.className="calc-code";
        const dot=document.createElement("span");
        dot.className="calc-dot";
        dot.style.background=it.hex || "#777777";
        const txt=document.createElement("span");
        txt.textContent=it.code;
        cCode.appendChild(dot);
        cCode.appendChild(txt);

        const cNeed=document.createElement("div");
        cNeed.className="num";
        cNeed.textContent=String(it.qty);

        const cInv=document.createElement("div");
        cInv.className="num";
        cInv.textContent=String(it.inventory);

        const cRemain=document.createElement("div");
        cRemain.className="num calc-remain";
        if(it.remain<0) cRemain.classList.add("debt");
        cRemain.textContent=String(it.remain);

        row.appendChild(cCode);
        row.appendChild(cNeed);
        row.appendChild(cInv);
        row.appendChild(cRemain);

        patternCalcList.appendChild(row);
      });
    }

    async function patternCalcRecognize(){
      if(!IS_LOGGED_IN){ toast("请登录后使用AI功能","warn"); return; }
      const file=patternCalcImageInput?.files?.[0];
      if(!file){
        toast("请先选择图纸图片","error");
        return;
      }

      const hadResult=patternCalcMergedMap.size>0;
      patternCalcRecognizeBtn.disabled=true;
      patternCalcRecognizeBtn.textContent="计算中…";
      showGlobalLoading("AI识别中，请稍候…");

      try{
        const fd=new FormData();
        fd.append("image", file);

        const res=await apiPostForm("/api/recognize-pattern", fd);

        const items = Array.isArray(res.items) ? res.items
                   : Array.isArray(res.data) ? res.data
                   : Array.isArray(res?.result?.items) ? res.result.items
                   : [];

        const normalized=normalizePatternCalcItems(items);

        if(normalized.length===0){
          if(!hadResult){
            if(patternCalcResultWrap) patternCalcResultWrap.style.display="block";
            if(patternCalcEmpty) patternCalcEmpty.style.display="block";
            if(patternCalcClearBtn) patternCalcClearBtn.style.display="inline-flex";
            if(patternCalcUnknown) patternCalcUnknown.textContent="";
            if(patternCalcTotalChip) patternCalcTotalChip.textContent="总消耗：0";
            if(patternCalcCountChip) patternCalcCountChip.textContent="色号：0";
            if(patternCalcShortChip) patternCalcShortChip.textContent="不足：0";
          }
          toast("未识别到有效色号，请换一张更清晰的图片","error");
          return;
        }

        patternCalcLastImageFile = file;
        const merged=mergePatternCalcItems(normalized);
        renderPatternCalc(merged);
        resetPatternCalcUploader();
        toast("计算完成","success");
      }catch(e){
        toast(e.message || "识别失败，请检查服务端接口","error");
      }finally{
        patternCalcRecognizeBtn.disabled=false;
        updatePatternCalcButton();
        hideGlobalLoading();
      }
    }

    document.getElementById("btnPatternCalc").addEventListener("click",()=>{
      clearPatternCalcResult();
      showPage("pattern-calc", {scrollTop:true, smooth:true});
    });
    document.getElementById("patternCalcClose").addEventListener("click",()=>showPage("records", {scrollTop:true, smooth:true}));
    patternCalcImageInput?.addEventListener("change",()=>{
      if(patternCalcImageName) patternCalcImageName.textContent = patternCalcImageInput.files[0]?.name || "未选择图纸";
    });
    patternCalcRecognizeBtn?.addEventListener("click", patternCalcRecognize);
    patternCalcClearBtn?.addEventListener("click", ()=>{ clearPatternCalcResult(); toast("已清空识别结果","success"); });

    // 添加待拼
    const todoAddDialog = document.getElementById("todoAddDialog");
    const todoAddPatternInput = document.getElementById("todoAddPattern");
    const todoAddCategorySelect = document.getElementById("todoAddCategory");
    const todoAddRows = document.getElementById("todoAddRows");
    const todoAddSummary = document.getElementById("todoAddSummary");
    const todoAddRowBtn = document.getElementById("todoAddRow");
    const todoAddConfirm = document.getElementById("todoAddConfirm");
    const todoAddCancel = document.getElementById("todoAddCancel");
    const todoAddClose = document.getElementById("todoAddClose");
    const todoAddImageInfo = document.getElementById("todoAddImageInfo");

    function updateTodoAddSummary(){
      if(!todoAddRows || !todoAddSummary) return;
      const rows = Array.from(todoAddRows.querySelectorAll(".record-row"));
      const codes = new Set();
      let total = 0;
      for(const row of rows){
        const inputs = row.querySelectorAll("input");
        const code = (inputs[0]?.value || "").trim().toUpperCase();
        const qtyStr = (inputs[1]?.value || "").trim();
        if(code) codes.add(code);
        const q = Number(qtyStr);
        if(Number.isInteger(q) && q > 0) total += q;
      }
      todoAddSummary.textContent = `已填写色号：${codes.size} 个 · 拼豆合计：${total} 粒`;
    }

    function fillTodoAddRows(items){
      if(!todoAddRows) return;
      todoAddRows.innerHTML = "";
      const list = Array.isArray(items) ? items.slice() : [];
      if(list.length === 0){
        createManualRow(todoAddRows, updateTodoAddSummary);
        return;
      }
      list.sort((a,b)=> (Number(b.qty||0)-Number(a.qty||0)) || sortCodes(String(a.code||""), String(b.code||"")));
      list.forEach(it=>{
        const row = createManualRow(todoAddRows, updateTodoAddSummary);
        const inputs = row ? row.querySelectorAll("input") : [];
        if(inputs[0]) inputs[0].value = String(it.code||"").trim().toUpperCase();
        if(inputs[1]) inputs[1].value = String(Number(it.qty||0) || "");
      });
      updateTodoAddSummary();
    }

    function openTodoAddDialog(){
      if(!IS_LOGGED_IN){ toast("请登录后使用此功能","warn"); return; }
      if(patternCalcMergedMap.size === 0){ toast("暂无识别结果","error"); return; }
      if(!patternCalcLastImageFile){ toast("请先上传图纸并完成计算","error"); return; }
      if(todoAddPatternInput) todoAddPatternInput.value = "";
      if(todoAddCategorySelect) todoAddCategorySelect.value = "";
      if(todoAddImageInfo){
        todoAddImageInfo.textContent = `已使用图纸：${patternCalcLastImageFile.name || "已选择图纸"}`;
      }
      const items = Array.from(patternCalcMergedMap.values()).map(it=>({code: it.code, qty: it.qty}));
      fillTodoAddRows(items);
      openDialog(todoAddDialog);
    }

    async function confirmTodoAdd(){
      if(!todoAddConfirm || todoAddConfirm.disabled) return;
      if(!todoAddRows){ toast("未初始化明细","error"); return; }
      if(!patternCalcLastImageFile){ toast("图纸图片缺失，请重新计算","error"); return; }
      const pattern = (todoAddPatternInput?.value || "").trim();
      if(pattern.length > 20){ toast("图纸名称不超过 20 字","error"); return; }
      const rows = Array.from(todoAddRows.querySelectorAll(".record-row"));
      const items = [];
      for(const row of rows){
        const inputs = row.querySelectorAll("input");
        const code = (inputs[0]?.value || "").trim().toUpperCase();
        const qtyStr = (inputs[1]?.value || "").trim();
        if(!code && !qtyStr) continue;
        if(!code || !MASTER_HEX[code]){ toast("存在空的色号或无效色号","error"); return; }
        const qty = Number(qtyStr);
        if(!Number.isInteger(qty) || qty <= 0){ toast("存在无效数量（必须为正整数）","error"); return; }
        items.push({code, qty});
      }
      if(items.length === 0){ toast("请至少添加一条记录","error"); return; }
      if(items.length > 100){ toast("单次最多支持 100 条记录","error"); return; }

      const patternCategoryId = (todoAddCategorySelect?.value || "").trim() || null;

      try{
        todoAddConfirm.disabled = true;
        const uploaded = await uploadPatternImage(patternCalcLastImageFile);
        const payload = {
          pattern: pattern || null,
          patternCategoryId,
          patternUrl: uploaded?.cdnUrl || null,
          patternKey: uploaded?.objectKey || null,
          items
        };
        if(uploaded?.objectKey){
          console.info("[todo] uploaded pattern", uploaded.objectKey);
        }
        await apiPost("/api/todoPatternAdd", payload);
        closeDialog(todoAddDialog);
        toast("已添加待拼","success");
        if(document.body.dataset.page === "todo"){
          await loadAndRenderTodoList();
        }
      }catch(e){
        toast(e?.message || "添加失败","error");
      }finally{
        if(todoAddConfirm) todoAddConfirm.disabled = false;
      }
    }

    if(patternCalcAddTodoBtn) patternCalcAddTodoBtn.addEventListener("click", openTodoAddDialog);
    if(todoAddClose) todoAddClose.addEventListener("click", ()=>closeDialog(todoAddDialog));
    if(todoAddCancel) todoAddCancel.addEventListener("click", ()=>closeDialog(todoAddDialog));
    if(todoAddRowBtn) todoAddRowBtn.addEventListener("click", ()=>createManualRow(todoAddRows, updateTodoAddSummary));
    if(todoAddConfirm) todoAddConfirm.addEventListener("click", confirmTodoAdd);
    if(patternCalcTodoEntry) patternCalcTodoEntry.addEventListener("click", ()=>{
      if(!IS_LOGGED_IN){ toast("请登录后查看","warn"); return; }
      showPage("todo", {scrollTop:true, smooth:true});
      renderTodoCategoryTabs();
      loadAndRenderTodoList();
    });
    document.getElementById("todoListClose").addEventListener("click",()=>showPage("pattern-calc", {scrollTop:true, smooth:true}));

    // 调整库存
    const adjustDialog=document.getElementById("adjustDialog");
    const adjustTypeSel=document.getElementById("adjustType");
    const adjustQtyInput=document.getElementById("adjustQty");
    const adjustTitle=document.getElementById("adjustTitle");
    let currentAdjustCode=null;

    function openAdjust(code){
      currentAdjustCode=code;
      adjustTitle.textContent=`调整库存 · ${code}`;
      adjustTypeSel.value="consume";
      adjustQtyInput.value="";
      openDialog(adjustDialog);
    }
    document.getElementById("adjustClose").addEventListener("click",()=>adjustDialog.close());
    const adjustConfirmBtn = document.getElementById("adjustConfirm");
    adjustConfirmBtn.addEventListener("click",async()=>{
      if(adjustConfirmBtn.disabled) return;
      adjustConfirmBtn.disabled = true;
      if(!currentAdjustCode){toast("未选择色号","error");adjustConfirmBtn.disabled=false;return;}
      const type=adjustTypeSel.value==="consume"?"consume":"restock";
      const qty=Number(adjustQtyInput.value);
      if(!Number.isInteger(qty)||qty<=0){toast("请输入正整数数量","error");adjustConfirmBtn.disabled=false;return;}
      const reqId = newRequestId();
      try{
        await apiPost("/api/adjust",{
          code:currentAdjustCode,
          type,
          qty,
          pattern:"",
          source:"manual"
        },{headers:{"x-idempotency-key": reqId}});
        await syncAll();
        adjustDialog.close();
        toast("调整成功","success");
      }catch{
        toast("调整失败","error");
      } finally {
        adjustConfirmBtn.disabled = false;
      }
    });

    // 筛选/搜索已移除

// 导出 CSV
    function downloadCsv(filename,text){
      const blob=new Blob([text],{type:"text/csv;charset=utf-8;"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=filename;
      document.body.appendChild(a);a.click();a.remove();
      URL.revokeObjectURL(url);
    }
    document.getElementById("btnExport").addEventListener("click",async()=>{
      try{
        const res=await apiGet("/api/all");
        const rows=res.data||[];
        const lines=["色号,数量"];
        rows.forEach(i=>lines.push(`${i.code},${i.qty}`));
        downloadCsv("拼豆库存导出.csv",lines.join("\n"));
        toast("已导出 CSV","success");
      }catch{
        toast("导出失败","error");
      }
    });


    const btnResetAll = document.getElementById("btnResetAll");
    if(btnResetAll){
      btnResetAll.addEventListener("click", ()=>{
        openConfirmDialog({
          title: "重置库存",
          text: "重置库存会将所有色号数量恢复为0，同时清空历史所有补充和消耗记录，请谨慎操作。是否确认重置？",
          confirmLabel: "确认重置",
          confirmClass: "btn-danger",
          onConfirm: async ()=>{
            try{
              if(confirmDialogConfirm) confirmDialogConfirm.disabled = true;
              await apiPost("/api/resetAll", {});
              await syncAll();
              closeConfirmDialog();
              toast("重置成功","success");
            }catch{
              if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
              toast("重置失败","error");
            }
          }
        });
      });
    }



        // 设置 + 添加色号
const criticalInput=document.getElementById("criticalInput");
    const seriesListEl=document.getElementById("seriesList");
    const patternCategoryInput = document.getElementById("patternCategoryInput");
    const patternCategoryAdd = document.getElementById("patternCategoryAdd");
    const patternCategoryList = document.getElementById("patternCategoryList");
	    const addCodeInput=document.getElementById("addCodeInput");
	    const addCodeSubmit=document.getElementById("addCodeSubmit");
    const settingsPrimaryBtn=document.getElementById("settingsPrimary");

    function isSeriesAdded(series){
      return Object.keys(COLORS).some(code=> (MASTER_SERIES[code]===series) && !MASTER_IS_DEFAULT[code]);
    }

    function renderSeriesManager(){
      if(!seriesListEl) return;
      seriesListEl.innerHTML="";
      NON_DEFAULT_SERIES.forEach(series=>{
        const added=isSeriesAdded(series);

        const row=document.createElement("div");
        row.className="series-row";

        const meta=document.createElement("div");
        meta.className="series-meta";
        const name=document.createElement("div");
        name.className="series-name";
        name.textContent=series;
        const sub=document.createElement("div");
        meta.appendChild(name);

        const btn=document.createElement("button");
        btn.className = added ? "btn-danger" : "btn-secondary";
        btn.textContent = added ? "删除" : "添加";

        btn.addEventListener("click", async()=>{
          if(!added){
            try{
              await apiPost("/api/addSeries",{series});
              await syncAll();
              toast(`已添加：${series}`,"success");
            }catch(e){
              toast(e.message||"添加失败","error");
            }
          }else{
            openConfirmDialog({
              title: "删除色系",
              text: `删除色系会清空库存，是否确认删除？\n\n色系：${series}`,
              confirmLabel: "确认删除",
              confirmClass: "btn-danger",
              onConfirm: async ()=>{
                try{
                  if(confirmDialogConfirm) confirmDialogConfirm.disabled = true;
                  await apiPost("/api/removeSeries",{series});
                  closeConfirmDialog();
                  await syncAll();
                  toast(`已删除：${series}`,"success");
                }catch(e){
                  if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
                  toast(e.message||"删除失败","error");
                }
              }
            });
          }
          renderSeriesManager();
        });

        row.appendChild(meta);
        row.appendChild(btn);
        seriesListEl.appendChild(row);
      });
    }

    function normalizeCategoryList(list){
      return (list||[])
        .map(c=>{
          const id = (c && c.id !== undefined && c.id !== null) ? String(c.id) : "";
          const name = normalizeCategoryName(c?.name || "");
          const createdAt = c?.createdAt || c?.created_at || "";
          return {id, name, createdAt};
        })
        .filter(c=>c.id && c.name);
    }

    function getPatternCategoryNameById(id){
      if(id === null || id === undefined || id === "") return "";
      const sid = String(id);
      const found = (PATTERN_CATEGORIES || []).find(c=>String(c.id)===sid);
      return found ? String(found.name || "") : "";
    }

    function renderPatternCategoryManager(){
      if(!patternCategoryList) return;
      patternCategoryList.innerHTML = "";
      const list = Array.isArray(PATTERN_CATEGORIES) ? PATTERN_CATEGORIES : [];
      if(list.length===0){
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "暂无分类";
        patternCategoryList.appendChild(empty);
        return;
      }
      list.forEach(cat=>{
        const row = document.createElement("div");
        row.className = "category-row";

        const name = document.createElement("div");
        name.className = "category-name";
        name.textContent = cat.name;

        const actions = document.createElement("div");
        actions.className = "category-actions";

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "btn-secondary";
        edit.textContent = "编辑";
        edit.addEventListener("click", async()=>{
          const next = prompt("编辑分类名称", cat.name);
          if(next === null) return;
          const val = normalizeCategoryName(next);
          if(!val){ toast("请输入分类名称","error"); return; }
          if(categoryDisplayLength(val) > 12){ toast("分类名称最多6个中文或12个英文","error"); return; }
          if(isCategoryNameDuplicate(val, cat.id)){ toast("分类已存在","error"); return; }
          try{
            await apiPost("/api/patternCategoryUpdate", {id: cat.id, name: val});
            await loadPatternCategories();
            toast("已更新分类","success");
          }catch(e){
            toast(e?.message || "更新失败","error");
          }
        });

        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn-danger";
        del.textContent = "删除";
        del.addEventListener("click", async()=>{
          openConfirmDialog({
            title: "删除分类",
            text: `删除分类将清空已标记的图纸分类信息，是否确认删除？\n\n分类：${cat.name}`,
            confirmLabel: "确认删除",
            confirmClass: "btn-danger",
            onConfirm: async ()=>{
              try{
                if(confirmDialogConfirm) confirmDialogConfirm.disabled = true;
                await apiPost("/api/patternCategoryDelete", {id: cat.id});
                if(ACTIVE_PATTERN_CATEGORY_ID && String(ACTIVE_PATTERN_CATEGORY_ID) === String(cat.id)){
                  ACTIVE_PATTERN_CATEGORY_ID = null;
                }
                closeConfirmDialog();
                await loadPatternCategories();
                toast("删除成功","success");
              }catch(e){
                if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
                toast(e?.message || "删除失败","error");
              }
            }
          });
        });

        row.appendChild(name);
        actions.appendChild(edit);
        actions.appendChild(del);
        row.appendChild(actions);
        patternCategoryList.appendChild(row);
      });
    }

    function renderPatternCategorySelects(){
      const selects = [
        document.getElementById("consumeManualCategory"),
        document.getElementById("consumeBatchCategory"),
        document.getElementById("consumeAiCategory"),
        document.getElementById("recordEditCategory"),
        document.getElementById("todoAddCategory")
      ].filter(Boolean);
      const list = Array.isArray(PATTERN_CATEGORIES) ? PATTERN_CATEGORIES : [];
      selects.forEach(select=>{
        const current = String(select.value || "");
        select.innerHTML = "";
        if(list.length===0){
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "请在我的页面添加分类";
          select.appendChild(opt);
          select.value = "";
          return;
        }
        const optNone = document.createElement("option");
        optNone.value = "";
        optNone.textContent = "不设置";
        select.appendChild(optNone);
        list.forEach(cat=>{
          const opt = document.createElement("option");
          opt.value = String(cat.id);
          opt.textContent = cat.name;
          select.appendChild(opt);
        });
        if(current && list.some(c=>String(c.id)===current)){
          select.value = current;
        }else{
          select.value = "";
        }
      });
    }

    function renderRecordsCategoryTabs(){
      const bar = document.getElementById("recordsCategoryBar");
      const listEl = document.getElementById("recordsCategoryList");
      if(!bar || !listEl) return;
      const list = (PATTERN_CATEGORIES||[]);
      if(list.length===0){
        bar.style.display = "none";
        listEl.innerHTML = "";
        return;
      }
      bar.style.display = (RECORDS_STATE && RECORDS_STATE.active === "consume") ? "" : "none";
      listEl.innerHTML = "";
      const createBtn = (label, id)=>{
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "category-chip" + ((id===null && !ACTIVE_PATTERN_CATEGORY_ID) || (id && String(ACTIVE_PATTERN_CATEGORY_ID)===String(id)) ? " active" : "");
        btn.textContent = label;
        btn.dataset.id = id===null ? "" : String(id);
        btn.addEventListener("click", ()=>{
          const nextId = btn.dataset.id ? String(btn.dataset.id) : null;
          if(String(ACTIVE_PATTERN_CATEGORY_ID||"") === String(nextId||"")) return;
          ACTIVE_PATTERN_CATEGORY_ID = nextId;
          renderRecordsCategoryTabs();
          if(RECORDS_STATE.active === "consume"){
            loadAndRenderRecordGroups();
          }
        });
        return btn;
      };
      listEl.appendChild(createBtn("全部", null));
      list.forEach(cat=>{
        listEl.appendChild(createBtn(cat.name, cat.id));
      });
    }

    function renderTodoCategoryTabs(){
      const bar = document.getElementById("todoCategoryBar");
      const listEl = document.getElementById("todoCategoryList");
      if(!bar || !listEl) return;
      const list = (PATTERN_CATEGORIES||[]);
      if(list.length===0){
        bar.style.display = "none";
        listEl.innerHTML = "";
        TODO_ACTIVE_CATEGORY_ID = null;
        return;
      }
      bar.style.display = "";
      listEl.innerHTML = "";
      const createBtn = (label, id)=>{
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "category-chip" + ((id===null && !TODO_ACTIVE_CATEGORY_ID) || (id && String(TODO_ACTIVE_CATEGORY_ID)===String(id)) ? " active" : "");
        btn.textContent = label;
        btn.dataset.id = id===null ? "" : String(id);
        btn.addEventListener("click", ()=>{
          const nextId = btn.dataset.id ? String(btn.dataset.id) : null;
          if(String(TODO_ACTIVE_CATEGORY_ID||"") === String(nextId||"")) return;
          TODO_ACTIVE_CATEGORY_ID = nextId;
          renderTodoCategoryTabs();
          loadAndRenderTodoList();
        });
        return btn;
      };
      listEl.appendChild(createBtn("全部", null));
      list.forEach(cat=>{
        listEl.appendChild(createBtn(cat.name, cat.id));
      });
    }

    function renderWorksCategoryTabs(){
      if(!worksCategoryBar || !worksCategoryList) return;
      const list = (PATTERN_CATEGORIES||[]);
      if(list.length===0){
        worksCategoryBar.style.display = "none";
        worksCategoryList.innerHTML = "";
        WORKS_STATE.categoryId = null;
        return;
      }
      worksCategoryBar.style.display = "";
      worksCategoryList.innerHTML = "";
      const createBtn = (label, id)=>{
        const btn = document.createElement("button");
        btn.type = "button";
        const active = (id===null && !WORKS_STATE.categoryId) || (id && String(WORKS_STATE.categoryId)===String(id));
        btn.className = "category-chip" + (active ? " active" : "");
        btn.textContent = label;
        btn.dataset.id = id===null ? "" : String(id);
        btn.addEventListener("click", ()=>{
          const nextId = btn.dataset.id ? String(btn.dataset.id) : null;
          if(String(WORKS_STATE.categoryId||"") === String(nextId||"")) return;
          WORKS_STATE.categoryId = nextId;
          renderWorksCategoryTabs();
          loadAndRenderWorks();
        });
        return btn;
      };
      worksCategoryList.appendChild(createBtn("全部", null));
      list.forEach(cat=>{
        worksCategoryList.appendChild(createBtn(cat.name, cat.id));
      });
    }

    async function loadPatternCategories(){
      try{
        const res = await apiGet("/api/patternCategories");
        PATTERN_CATEGORIES = normalizeCategoryList(res?.data || []);
      }catch{
        PATTERN_CATEGORIES = [];
      }
      if(ACTIVE_PATTERN_CATEGORY_ID && !PATTERN_CATEGORIES.some(c=>String(c.id)===String(ACTIVE_PATTERN_CATEGORY_ID))){
        ACTIVE_PATTERN_CATEGORY_ID = null;
      }
      if(TODO_ACTIVE_CATEGORY_ID && !PATTERN_CATEGORIES.some(c=>String(c.id)===String(TODO_ACTIVE_CATEGORY_ID))){
        TODO_ACTIVE_CATEGORY_ID = null;
      }
      if(WORKS_STATE.categoryId && !PATTERN_CATEGORIES.some(c=>String(c.id)===String(WORKS_STATE.categoryId))){
        WORKS_STATE.categoryId = null;
      }
      renderPatternCategoryManager();
      renderPatternCategorySelects();
      renderRecordsCategoryTabs();
      renderTodoCategoryTabs();
      renderWorksCategoryTabs();
      if(RECORDS_STATE && RECORDS_STATE.active === "consume"){
        loadAndRenderRecordGroups();
      }
      if(document.body.dataset.page === "todo"){
        loadAndRenderTodoList();
      }
    }

    if(criticalInput) criticalInput.value = CRITICAL_THRESHOLD;

	    if(addCodeSubmit && addCodeInput){
	      const _submitAddCode = async ()=>{
	        const code = String(addCodeInput.value||"").trim().toUpperCase();
	        if(!code){ toast("请输入色号","error"); return; }
	        if(!MASTER_HEX[code]){ toast("非MARD色号，请检查后重新输入","error"); return; }
	        if(code in COLORS){ toast("色号已存在","error"); return; }
	        try{
	          addCodeSubmit.disabled = true;
	          await apiPost("/api/addColor", {code});
	          await syncAll();
	          addCodeInput.value = "";
	          toast("已添加色号","success");
	        }catch(e){
	          toast(e?.message || "添加失败","error");
	        }finally{
	          addCodeSubmit.disabled = false;
	        }
	      };
	      addCodeSubmit.addEventListener("click", _submitAddCode);
	      addCodeInput.addEventListener("keydown", (e)=>{
	        if(e.key==="Enter") _submitAddCode();
	      });
	    }

    if(patternCategoryAdd && patternCategoryInput){
      const _submitCategory = async ()=>{
        const name = normalizeCategoryName(patternCategoryInput.value);
        if(!name){ toast("请输入分类名称","error"); return; }
        if((PATTERN_CATEGORIES||[]).length >= MAX_PATTERN_CATEGORIES){
          toast(`最多只能创建${MAX_PATTERN_CATEGORIES}个分类`,"error");
          return;
        }
        if(categoryDisplayLength(name) > 12){
          toast("分类名称最多6个中文或12个英文","error");
          return;
        }
        if(isCategoryNameDuplicate(name)){
          toast("分类已存在","error");
          return;
        }
        try{
          patternCategoryAdd.disabled = true;
          await apiPost("/api/patternCategories", {name});
          patternCategoryInput.value = "";
          await loadPatternCategories();
          toast("已添加分类","success");
        }catch(e){
          toast(e?.message || "添加失败","error");
        }finally{
          patternCategoryAdd.disabled = false;
        }
      };
      patternCategoryAdd.addEventListener("click", _submitCategory);
      patternCategoryInput.addEventListener("keydown", (e)=>{
        if(e.key==="Enter") _submitCategory();
      });
    }

    if(settingsPrimaryBtn) settingsPrimaryBtn.addEventListener("click",async()=>{

      const critical=Number(criticalInput.value);
      if(!Number.isInteger(critical)||critical<=0){toast("数量必须为正整数","error");return;}

      try{
        const res=await apiPost("/api/settings",{criticalThreshold:critical});
        CRITICAL_THRESHOLD = Number(res.criticalThreshold ?? critical) || critical;
        updateThresholdUI();
        renderAll();
        toast("已保存","success");
      }catch(e){
        console.error(e);
        toast("保存失败","error");
      }
    });
    const recordsDialog = document.getElementById("recordsDialog");

    const recordEditDialog = document.getElementById("recordEditDialog");
    const recordEditTitle = document.getElementById("recordEditTitle");
    const recordEditPatternField = document.getElementById("recordEditPatternField");
    const recordEditPatternInput = document.getElementById("recordEditPattern");
    const recordEditCategoryField = document.getElementById("recordEditCategoryField");
    const recordEditCategorySelect = document.getElementById("recordEditCategory");
    const recordEditImageField = document.getElementById("recordEditImageField");
    const recordEditImageInput = document.getElementById("recordEditImage");
    const recordEditImageName = document.getElementById("recordEditImageName");
    const recordEditImagePreview = document.getElementById("recordEditImagePreview");
    const recordEditImagePreviewImg = document.getElementById("recordEditImagePreviewImg");
    const recordEditImageClear = document.getElementById("recordEditImageClear");
    const recordEditRows = document.getElementById("recordEditRows");
    const recordEditAddRow = document.getElementById("recordEditAddRow");
    const recordEditCancel = document.getElementById("recordEditCancel");
    const recordEditDelete = document.getElementById("recordEditDelete");
    const recordEditConfirm = document.getElementById("recordEditConfirm");
    const recordEditClose = document.getElementById("recordEditClose");

    const workDialog = document.getElementById("workDialog");
    const workDialogClose = document.getElementById("workDialogClose");
    const workDialogCancel = document.getElementById("workDialogCancel");
    const workDialogSave = document.getElementById("workDialogSave");
    const workDialogDelete = document.getElementById("workDialogDelete");
    const workCropperDialog = document.getElementById("workCropperDialog");
    const workUploadBox = document.getElementById("workUploadBox");
    const workUploadPlaceholder = document.getElementById("workUploadPlaceholder");
    const workUploadPreview = document.getElementById("workUploadPreview");
    const workUploadInput = document.getElementById("workUploadInput");
    const workUploadReupload = document.getElementById("workUploadReupload");
    const workCropperWrap = document.getElementById("workCropperWrap");
    const workCropperImage = document.getElementById("workCropperImage");
    const workCropperZoom = document.getElementById("workCropperZoom");
    const workCropperCancel = document.getElementById("workCropperCancel");
    const workCropperConfirm = document.getElementById("workCropperConfirm");
    const workFinishedAtWrap = document.getElementById("workFinishedAtWrap");
    const workFinishedAtInput = document.getElementById("workFinishedAt");
    const workDurationHours = document.getElementById("workDurationHours");
    const workDurationMinutes = document.getElementById("workDurationMinutes");
    const workNoteInput = document.getElementById("workNote");
    const workDetailDialog = document.getElementById("workDetailDialog");
    const workDetailClose = document.getElementById("workDetailClose");
    const workDetailEdit = document.getElementById("workDetailEdit");
    const workDetailShare = document.getElementById("workDetailShare");
    const workDetailImageWrap = document.getElementById("workDetailImageWrap");
    const workDetailImage = document.getElementById("workDetailImage");
    const workDetailTitle = document.getElementById("workDetailTitle");
    const workDetailStats = document.getElementById("workDetailStats");
    const workDetailTime = document.getElementById("workDetailTime");
    const workDetailTag = document.getElementById("workDetailTag");
    const workDetailNotes = document.getElementById("workDetailNotes");


    const recordsOnlyWithPattern = document.getElementById("recordsOnlyWithPattern");
    const recordsConsumeTotalChip = document.getElementById("recordsConsumeTotalChip");
    const recordsConsumeList = document.getElementById("recordsConsumeList");
    const recordsRestockList = document.getElementById("recordsRestockList");
    const recordsConsumeEmpty = document.getElementById("recordsConsumeEmpty");
    const recordsRestockEmpty = document.getElementById("recordsRestockEmpty");
    const recordsStatsList = document.getElementById("recordsStatsList");
    const recordsStatsEmpty = document.getElementById("recordsStatsEmpty");
    const recordsStatsTotalConsume = document.getElementById("recordsStatsTotalConsume");
    const recordsStatsTotalInventory = document.getElementById("recordsStatsTotalInventory");
    const recordsStatsConsumeCount = document.getElementById("recordsStatsConsumeCount");
    const recordsStatsRestockCount = document.getElementById("recordsStatsRestockCount");
    const recordsStatsFilter = document.getElementById("recordsStatsFilter");
    const todoList = document.getElementById("todoList");
    const todoEmpty = document.getElementById("todoEmpty");
    const worksPanel = document.getElementById("worksPanel");
    const worksStats = document.getElementById("worksStats");
    const worksTotalCount = document.getElementById("worksTotalCount");
    const worksTotalConsume = document.getElementById("worksTotalConsume");
    const worksTotalDuration = document.getElementById("worksTotalDuration");
    const worksCategoryBar = document.getElementById("worksCategoryBar");
    const worksCategoryList = document.getElementById("worksCategoryList");
    const worksList = document.getElementById("worksList");
    const worksEmpty = document.getElementById("worksEmpty");
    const worksEmptyAction = document.getElementById("worksEmptyAction");

    const RECORDS_STATE = {
      active: "consume",
      expanded: new Set(),
      detailCache: new Map(),
      pendingEdit: null,
      pageSize: 30,
      cursor: null,
      hasMore: true,
      loading: false,
      requestSeq: 0,
      cacheKey: "",
      retryAt: 0,
      consumeTotal: 0,
      statsDays: 0,
      workMap: new Map()
    };
    const TODO_STATE = {
      pendingEdit: null
    };
    const WORKS_STATE = {
      categoryId: null,
      pageSize: 30,
      cursor: null,
      hasMore: true,
      loading: false,
      requestSeq: 0,
      cacheKey: "",
      list: [],
      deferLoad: false
    };
    const WORK_PUBLISHED_GIDS = new Set();
    const WORK_STATE = {
      gid: null,
      editId: null,
      editItem: null,
      cropper: null,
      cropperBaseRatio: 1,
      cropperReady: false,
      cropperUrl: "",
      previewUrl: "",
      croppedFile: null,
      prevFile: null,
      busy: false,
      triggerButton: null
    };
    const RECORDS_IMG_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
    let recordListObserver = null;
    let recordListObserverRoot = null;
    let recordImageObserver = null;
    let recordImageObserverRoot = null;

    function _recKey(type,gid){ return `${type}|${gid}`; }
    function setRecordToggleButton(btn, expanded){
      const label = expanded ? "收起" : "展开";
      const icon = iosIcon(expanded ? "chevronUp" : "chevronDown");
      btn.innerHTML = `<span class="toggle-text">${label}</span><span class="toggle-icon">${icon}</span>`;
      btn.setAttribute("aria-label", label);
    }

    function setPublishButtonState(btn, published){
      if(!btn) return;
      btn.textContent = published ? "已发布" : "发布作品";
      btn.disabled = !!published;
      btn.classList.toggle("is-published", !!published);
    }

    function revokeObjectUrl(url){
      if(url && typeof url === "string" && url.startsWith("blob:")){
        try{ URL.revokeObjectURL(url); }catch{}
      }
    }

    function cleanupWorkCropper(){
      if(WORK_STATE.cropper){
        try{ WORK_STATE.cropper.destroy(); }catch{}
        WORK_STATE.cropper = null;
      }
      if(WORK_STATE.cropperUrl){
        revokeObjectUrl(WORK_STATE.cropperUrl);
        WORK_STATE.cropperUrl = "";
      }
    }

    function setWorkPreview(url){
      if(workUploadBox) workUploadBox.classList.toggle("has-preview", !!url);
      if(workUploadPreview){
        if(url) workUploadPreview.src = url;
        else workUploadPreview.removeAttribute("src");
      }
      if(workUploadReupload) workUploadReupload.style.display = url ? "" : "none";
    }

    function updateWorkPreview(url){
      if(WORK_STATE.previewUrl && WORK_STATE.previewUrl !== url){
        revokeObjectUrl(WORK_STATE.previewUrl);
      }
      WORK_STATE.previewUrl = url || "";
      setWorkPreview(url);
    }

    function resetWorkDialog(){
      WORK_STATE.gid = null;
      WORK_STATE.editId = null;
      WORK_STATE.editItem = null;
      WORK_STATE.croppedFile = null;
      WORK_STATE.prevFile = null;
      WORK_STATE.busy = false;
      WORK_STATE.triggerButton = null;
      WORK_STATE.cropperBaseRatio = 1;
      WORK_STATE.cropperReady = false;
      if(workCropperDialog && workCropperDialog.open){
        closeDialog(workCropperDialog);
      }
      if(workDialog) workDialog.classList.remove("is-locked");
      const bd = document.querySelector('.modal-backdrop');
      if(bd) bd.classList.remove('submodal');
      if(workDurationHours) workDurationHours.value = "";
      if(workDurationMinutes) workDurationMinutes.value = "";
      if(workNoteInput) workNoteInput.value = "";
      if(workFinishedAtInput){
        const now = new Date();
        const value = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
        workFinishedAtInput.value = value;
      }
      if(workUploadInput) workUploadInput.value = "";
      if(workDialogSave) workDialogSave.disabled = true;
      if(workDialogDelete) workDialogDelete.style.display = "none";
      if(workDialog){
        const title = workDialog.querySelector(".modal-head h3");
        if(title) title.textContent = "发布作品";
      }
      if(workCropperWrap) workCropperWrap.style.display = "none";
      cleanupWorkCropper();
      updateWorkPreview("");
      if(workUploadPlaceholder) workUploadPlaceholder.style.display = "";
    }

    function openWorkDialog(gid, btn){
      if(!workDialog) return;
      resetWorkDialog();
      WORK_STATE.gid = String(gid || "");
      WORK_STATE.triggerButton = btn || null;
      openDialog(workDialog);
    }

    function startWorkCropper(file){
      if(!workCropperWrap || !workCropperImage) return;
      if(!window.Cropper){
        toast("裁剪组件加载失败，请稍后再试","error");
        return;
      }
      if(!workCropperWrap.__gestureGuard){
        const guard = (e)=>{
          if(e.cancelable) e.preventDefault();
        };
        workCropperWrap.addEventListener("touchstart", guard, {passive:false});
        workCropperWrap.addEventListener("touchmove", guard, {passive:false});
        workCropperWrap.__gestureGuard = true;
      }
      if(workDialog) workDialog.classList.add("is-locked");
      if(workCropperDialog) openDialog(workCropperDialog);
      const bd = document.querySelector('.modal-backdrop');
      if(bd) bd.classList.add('submodal');
      if(workCropperZoom){
        workCropperZoom.disabled = true;
        workCropperZoom.min = "1";
        workCropperZoom.max = "3";
        workCropperZoom.step = "0.01";
        workCropperZoom.value = "1";
      }
      WORK_STATE.cropperReady = false;
      WORK_STATE.cropperBaseRatio = 1;
      cleanupWorkCropper();
      const url = URL.createObjectURL(file);
      WORK_STATE.cropperUrl = url;
      workCropperImage.onload = () => {
        try{
          WORK_STATE.cropper = new window.Cropper(workCropperImage, {
            aspectRatio: 1,
            viewMode: 1,
            dragMode: "move",
            autoCropArea: 1,
            background: false,
            checkOrientation: false,
            cropBoxMovable: false,
            cropBoxResizable: false,
            toggleDragModeOnDblclick: false,
            zoomOnTouch: true,
            zoomOnWheel: false,
            ready(){
              const cropper = WORK_STATE.cropper;
              if(cropper && workCropperZoom){
                const fitCropBox = ()=>{
                  const container = cropper.getContainerData();
                  if(container && Number.isFinite(container.width) && Number.isFinite(container.height)){
                    const size = Math.min(container.width, container.height);
                    const left = (container.width - size) / 2;
                    const top = (container.height - size) / 2;
                    try{
                      cropper.setCropBoxData({ left, top, width: size, height: size });
                    }catch{}
                  }
                };
                const updateBaseRatio = ()=>{
                  const imageData = cropper.getImageData();
                  const cropBox = cropper.getCropBoxData();
                  let ratio = imageData?.ratio;
                  if(!Number.isFinite(ratio) || ratio <= 0){
                    const nW = Number(imageData?.naturalWidth || 0);
                    const nH = Number(imageData?.naturalHeight || 0);
                    const cW = Number(cropBox?.width || 0);
                    const cH = Number(cropBox?.height || 0);
                    if(nW > 0 && nH > 0 && cW > 0 && cH > 0){
                      ratio = Math.max(cW / nW, cH / nH);
                    }
                  }
                  if(!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
                  WORK_STATE.cropperBaseRatio = ratio;
                  try{ cropper.zoomTo(ratio); }catch{}
                };
                fitCropBox();
                updateBaseRatio();
                requestAnimationFrame(()=>{ fitCropBox(); updateBaseRatio(); });
                setTimeout(()=>{ fitCropBox(); updateBaseRatio(); }, 80);
                workCropperZoom.min = "1";
                workCropperZoom.max = "3";
                workCropperZoom.step = "0.01";
                workCropperZoom.value = "1";
                workCropperZoom.disabled = false;
                WORK_STATE.cropperReady = true;
              }
            }
          });
        }catch(e){
          toast("裁剪组件初始化失败","error");
        }
      };
      workCropperImage.src = url;
      workCropperWrap.style.display = "";
    }

    async function confirmWorkCrop(){
      if(!WORK_STATE.cropper) return;
      try{
        const canvas = WORK_STATE.cropper.getCroppedCanvas({
          width: 1024,
          height: 1024,
          imageSmoothingQuality: "high"
        });
        if(!canvas){
          toast("裁剪失败，请重试","error");
          return;
        }
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.92));
        if(!blob){
          toast("裁剪失败，请重试","error");
          return;
        }
        const file = new File([blob], `work-${Date.now()}.webp`, { type: "image/webp" });
        WORK_STATE.croppedFile = file;
        WORK_STATE.prevFile = null;
        const previewUrl = URL.createObjectURL(blob);
        updateWorkPreview(previewUrl);
        if(workDialogSave) workDialogSave.disabled = false;
        if(workCropperWrap) workCropperWrap.style.display = "none";
        cleanupWorkCropper();
        WORK_STATE.cropperReady = false;
        if(workCropperDialog) closeDialog(workCropperDialog);
        if(workDialog) workDialog.classList.remove("is-locked");
        const bd = document.querySelector('.modal-backdrop');
        if(bd) bd.classList.remove('submodal');
      }catch(e){
        toast("裁剪失败，请重试","error");
      }
    }

    function cancelWorkCrop(){
      if(workCropperWrap) workCropperWrap.style.display = "none";
      if(workUploadInput) workUploadInput.value = "";
      cleanupWorkCropper();
      WORK_STATE.cropperReady = false;
      if(workCropperDialog) closeDialog(workCropperDialog);
      if(workDialog) workDialog.classList.remove("is-locked");
      const bd = document.querySelector('.modal-backdrop');
      if(bd) bd.classList.remove('submodal');
      if(WORK_STATE.prevFile){
        WORK_STATE.croppedFile = WORK_STATE.prevFile;
        WORK_STATE.prevFile = null;
        if(workDialogSave) workDialogSave.disabled = false;
      }else{
        if(workDialogSave) workDialogSave.disabled = !WORK_STATE.croppedFile && !WORK_STATE.editId;
      }
    }

    async function saveWork(){
      if(WORK_STATE.busy) return;
      if(!IS_LOGGED_IN){
        toast("请登录后发布作品","warn");
        return;
      }
      const gid = String(WORK_STATE.gid || "");
      const isEdit = !!WORK_STATE.editId;
      if(!gid && !isEdit){
        toast("记录异常，请重试","error");
        return;
      }
      const hasNewImage = !!WORK_STATE.croppedFile;
      if(!hasNewImage && !isEdit){
        toast("请先上传作品图","warn");
        return;
      }
      const durationInfo = normalizeDurationInputs();
      if(durationInfo.totalMinutes < 1){
        toast("完成时长至少 1 分钟","warn");
        return;
      }
      if(durationInfo.totalMinutes > 100 * 60 + 60){
        toast("完成时长不能超过 100 小时","warn");
        return;
      }
      WORK_STATE.busy = true;
      if(workDialogSave) workDialogSave.disabled = true;
      try{
        let upload = null;
        if(hasNewImage){
          upload = await uploadPatternImage(WORK_STATE.croppedFile);
          if(!upload || !upload.cdnUrl) throw new Error("图片上传失败");
        }
        const durationLabel = (() => {
          const h = durationInfo.hours || 0;
          const m = durationInfo.minutes || 0;
          if(h > 0 && m > 0) return `${h}小时${m}分钟`;
          if(h > 0) return `${h}小时`;
          return `${m}分钟`;
        })();
        const noteValue = (workNoteInput?.value || "").trim().slice(0, 50) || null;
        const finishedAt = (workFinishedAtInput?.value || "").trim() || null;
        if(isEdit){
          const payload = {
            workId: WORK_STATE.editId,
            duration: durationLabel,
            durationMinutes: durationInfo.totalMinutes,
            note: noteValue,
            finishedAt
          };
          if(upload && upload.cdnUrl){
            payload.imageUrl = upload.cdnUrl;
            payload.imageKey = upload.objectKey || "";
          }
          await apiPost("/api/workUpdate", payload);
          toast("作品保存成功","success");
        }else{
          const payload = {
            gid,
            type: "consume",
            imageUrl: upload.cdnUrl,
            imageKey: upload.objectKey || "",
            duration: durationLabel,
            durationMinutes: durationInfo.totalMinutes,
            note: noteValue,
            finishedAt
          };
          await apiPost("/api/workPublish", payload);
          WORK_PUBLISHED_GIDS.add(gid);
          if(WORK_STATE.triggerButton){
            setPublishButtonState(WORK_STATE.triggerButton, true);
          }
          toast("作品保存成功","success");
        }
        if(document.body.dataset.page === "works"){
          await loadAndRenderWorks();
        }
        if(workDetailDialog && workDetailDialog.open) closeDialog(workDetailDialog);
        if(workDialog) closeDialog(workDialog);
      }catch(e){
        toast(e?.message || "作品保存失败","error");
      }finally{
        WORK_STATE.busy = false;
        if(workDialogSave) workDialogSave.disabled = !WORK_STATE.croppedFile && !WORK_STATE.editId;
      }
    }

    function triggerWorkUpload(){
      if(!IS_LOGGED_IN){
        toast("请登录后发布作品","warn");
        return;
      }
      if(workUploadInput) workUploadInput.click();
    }

    function clampNumber(val, min, max){
      const num = Number(val);
      if(!Number.isFinite(num)) return null;
      const rounded = Math.floor(num);
      if(rounded < min) return min;
      if(rounded > max) return max;
      return rounded;
    }

    function normalizeDurationInputs(){
      const hRaw = clampNumber(workDurationHours?.value, 0, 100);
      const mRaw = clampNumber(workDurationMinutes?.value, 0, 60);
      if(workDurationHours && hRaw !== null) workDurationHours.value = String(hRaw);
      if(workDurationMinutes && mRaw !== null) workDurationMinutes.value = String(mRaw);

      if(hRaw === null && mRaw === null) return { hours: 0, minutes: 0, totalMinutes: 0 };
      let hours = hRaw === null ? 0 : hRaw;
      let minutes = mRaw === null ? 0 : mRaw;
      if(minutes === 60){
        if(hours < 100){
          hours += 1;
          minutes = 0;
          if(workDurationHours) workDurationHours.value = String(hours);
          if(workDurationMinutes) workDurationMinutes.value = "0";
        }
      }
      const totalMinutes = hours * 60 + minutes;
      return { hours, minutes, totalMinutes };
    }

    function setRecordsTab(type){
      type = (type==="restock" || type==="stats") ? type : "consume";
      RECORDS_STATE.active = type;

      document.querySelectorAll("#recordsDialog .tab-nav .tab-btn").forEach(btn=>{
        btn.classList.toggle("active", (btn.dataset.tab === "records-" + type));
      });
      const consumePanel = document.getElementById("recordsConsumePanel");
      const restockPanel = document.getElementById("recordsRestockPanel");
      const statsPanel = document.getElementById("recordsStatsPanel");
      if(consumePanel) consumePanel.classList.toggle("active", type==="consume");
      if(restockPanel) restockPanel.classList.toggle("active", type==="restock");
      if(statsPanel) statsPanel.classList.toggle("active", type==="stats");

      // checkbox only for consume
      const toolbar = recordsOnlyWithPattern ? recordsOnlyWithPattern.closest(".records-toolbar") : null;
      if(toolbar) toolbar.style.display = type==="consume" ? "" : "none";
      const categoryBar = document.getElementById("recordsCategoryBar");
      if(categoryBar) categoryBar.style.display = (type==="consume" && (PATTERN_CATEGORIES||[]).length>0) ? "" : "none";

      if(type==="stats"){
        if(recordListObserver) recordListObserver.disconnect();
        if(recordImageObserver) recordImageObserver.disconnect();
        loadAndRenderConsumeStats();
      }else{
        loadAndRenderRecordGroups();
      }
    }

    if(confirmDialogClose) confirmDialogClose.addEventListener("click", closeConfirmDialog);
    if(confirmDialogCancel) confirmDialogCancel.addEventListener("click", closeConfirmDialog);
    if(confirmDialogConfirm){
      confirmDialogConfirm.addEventListener("click", async ()=>{
        if(!CONFIRM_PENDING) return closeConfirmDialog();
        const runner = CONFIRM_PENDING;
        try{
          await runner();
        }catch{}
      });
    }

    function setStatsFilterDays(days){
      const d = Number(days) || 0;
      RECORDS_STATE.statsDays = d > 0 ? d : 0;
      if(recordsStatsFilter){
        recordsStatsFilter.querySelectorAll(".category-chip").forEach(btn=>{
          const v = Number(btn.dataset.days || 0) || 0;
          const active = v === RECORDS_STATE.statsDays;
          btn.classList.toggle("active", active);
          btn.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
      if(RECORDS_STATE.active === "stats"){
        loadAndRenderConsumeStats();
      }
    }

    if(recordsStatsFilter){
      recordsStatsFilter.querySelectorAll(".category-chip").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          setStatsFilterDays(btn.dataset.days || 0);
        });
      });
    }

    function getRecordsScrollRoot(listEl){
      if(!listEl) return null;
      const modalBody = listEl.closest(".modal-body");
      if(modalBody) return modalBody;
      const panel = listEl.closest(".panel");
      if(panel){
        const overflowY = getComputedStyle(panel).overflowY;
        if(overflowY === "auto" || overflowY === "scroll") return panel;
      }
      const page = listEl.closest(".page");
      if(page){
        const overflowY = getComputedStyle(page).overflowY;
        if(overflowY === "auto" || overflowY === "scroll") return page;
      }
      return null;
    }

    function ensureRecordSentinel(listEl){
      if(!listEl) return null;
      let sentinel = listEl.querySelector(".list-sentinel");
      if(!sentinel){
        sentinel = document.createElement("div");
        sentinel.className = "list-sentinel";
        sentinel.setAttribute("aria-hidden","true");
        sentinel.style.width = "100%";
        sentinel.style.height = "1px";
        sentinel.style.pointerEvents = "none";
        listEl.appendChild(sentinel);
      }
      return sentinel;
    }

    function ensureRecordListObserver(rootEl){
      if(!("IntersectionObserver" in window)) return null;
      const root = rootEl || null;
      if(recordListObserver && recordListObserverRoot === root) return recordListObserver;
      if(recordListObserver) recordListObserver.disconnect();
      recordListObserverRoot = root;
      recordListObserver = new IntersectionObserver((entries)=>{
        for(const ent of entries){
          if(ent.isIntersecting){
            maybeLoadMoreRecordGroups();
            break;
          }
        }
      }, { root, rootMargin: "600px 0px 600px 0px", threshold: 0 });
      return recordListObserver;
    }

    function ensureRecordImageObserver(rootEl){
      if(!("IntersectionObserver" in window)) return null;
      const root = rootEl || null;
      if(recordImageObserver && recordImageObserverRoot === root) return recordImageObserver;
      if(recordImageObserver) recordImageObserver.disconnect();
      recordImageObserverRoot = root;
      recordImageObserver = new IntersectionObserver((entries)=>{
        for(const ent of entries){
          if(ent.isIntersecting){
            const img = ent.target;
            const src = img.dataset ? img.dataset.src : null;
            if(src){
              img.src = src;
              img.removeAttribute("data-src");
            }
            recordImageObserver.unobserve(img);
          }
        }
      }, { root, rootMargin: "300px 0px 300px 0px", threshold: 0 });
      return recordImageObserver;
    }

    function observeRecordImages(listEl){
      if(!listEl) return;
      const imgs = listEl.querySelectorAll("img[data-src]");
      if(imgs.length===0) return;
      if(!("IntersectionObserver" in window)){
        imgs.forEach(img=>{
          if(img.dataset && img.dataset.src){
            img.src = img.dataset.src;
            img.removeAttribute("data-src");
          }
        });
        return;
      }
      const root = getRecordsScrollRoot(listEl);
      const observer = ensureRecordImageObserver(root);
      if(!observer) return;
      imgs.forEach(img=> observer.observe(img));
    }

    function resetRecordsPaging(type){
      RECORDS_STATE.cursor = null;
      RECORDS_STATE.hasMore = true;
      RECORDS_STATE.loading = false;
      RECORDS_STATE.retryAt = 0;
      RECORDS_STATE.consumeTotal = 0;
      RECORDS_STATE.expanded.clear();
      RECORDS_STATE.detailCache.clear();
      if(type === "consume"){
        RECORDS_STATE.workMap.clear();
        WORK_PUBLISHED_GIDS.clear();
      }
      const listEl = type==="consume" ? recordsConsumeList : recordsRestockList;
      const emptyEl = type==="consume" ? recordsConsumeEmpty : recordsRestockEmpty;
      if(listEl) listEl.innerHTML = "";
      if(emptyEl) emptyEl.style.display = "none";
      if(type==="consume" && recordsConsumeTotalChip){
        recordsConsumeTotalChip.textContent = "总消耗：0";
      }
    }

    function maybeLoadMoreRecordGroups(){
      if(RECORDS_STATE.loading || !RECORDS_STATE.hasMore) return;
      if(RECORDS_STATE.retryAt && Date.now() < RECORDS_STATE.retryAt) return;
      fetchRecordGroupsPage({reset:false});
    }

    async function fetchRecordGroupsPage({reset}){
      const type = RECORDS_STATE.active;
      if(type==="stats") return;
      const listEl = type==="consume" ? recordsConsumeList : recordsRestockList;
      const emptyEl = type==="consume" ? recordsConsumeEmpty : recordsRestockEmpty;
      if(!listEl || !emptyEl) return;

      const only = !!(recordsOnlyWithPattern && recordsOnlyWithPattern.checked) && type==="consume";
      const categoryParam = (type==="consume" && ACTIVE_PATTERN_CATEGORY_ID) ? String(ACTIVE_PATTERN_CATEGORY_ID) : "";
      const key = `${type}|${only ? 1 : 0}|${categoryParam || ""}`;
      if(reset || RECORDS_STATE.cacheKey !== key){
        RECORDS_STATE.cacheKey = key;
        resetRecordsPaging(type);
        reset = true;
      }
      if(RECORDS_STATE.loading) return;
      if(!reset && !RECORDS_STATE.hasMore) return;
      if(!reset && RECORDS_STATE.retryAt && Date.now() < RECORDS_STATE.retryAt) return;

      const params = new URLSearchParams();
      params.set("type", type);
      if(only) params.set("onlyWithPattern","1");
      if(categoryParam) params.set("patternCategoryId", categoryParam);
      params.set("limit", String(RECORDS_STATE.pageSize));
      if(!reset && RECORDS_STATE.cursor){
        params.set("cursor", String(RECORDS_STATE.cursor));
      }

      const url = `/api/recordGroups?${params.toString()}`;
      const seq = ++RECORDS_STATE.requestSeq;
      RECORDS_STATE.loading = true;
      try{
        const res = await apiGet(url);
        if(seq !== RECORDS_STATE.requestSeq) return;
        const groups = Array.isArray(res?.data) ? res.data : [];
        const hasMore = !!res?.hasMore;
        const nextCursor = res?.nextCursor ? String(res.nextCursor) : null;
        RECORDS_STATE.cursor = nextCursor || null;
        RECORDS_STATE.hasMore = hasMore && !!nextCursor;
        renderRecordGroups(type, groups, {append: !reset});
        const root = getRecordsScrollRoot(listEl);
        const sentinel = ensureRecordSentinel(listEl);
        const observer = ensureRecordListObserver(root);
        if(observer && sentinel){
          observer.disconnect();
          observer.observe(sentinel);
        }
      }catch(e){
        if(seq !== RECORDS_STATE.requestSeq) return;
        const msg = e?.message || (reset ? "加载记录失败" : "加载更多失败");
        toast(msg, "error");
        RECORDS_STATE.retryAt = Date.now() + 1000;
      }finally{
        if(seq === RECORDS_STATE.requestSeq){
          RECORDS_STATE.loading = false;
        }
      }
    }

    async function loadAndRenderRecordGroups(){
      await fetchRecordGroupsPage({reset:true});
    }

    async function loadAndRenderConsumeStats(){
      try{
        const days = RECORDS_STATE.statsDays || 0;
        const statsUrl = days > 0 ? `/api/consumeStats?days=${encodeURIComponent(days)}` : "/api/consumeStats";
        const [statsRes, summaryRes] = await Promise.all([
          apiGet(statsUrl),
          apiGet("/api/recordsStatsSummary")
        ]);
        const items = Array.isArray(statsRes?.data) ? statsRes.data : [];
        const listSummary = renderConsumeStats(items);
        const summary = summaryRes?.data || summaryRes || {};
        const totalConsume = Number(summary?.totalConsume ?? listSummary.totalConsume ?? 0) || 0;
        const totalInventory = Number(summary?.totalInventory ?? 0) || 0;
        const consumeCount = Number(summary?.consumeCount ?? 0) || 0;
        const restockCount = Number(summary?.restockCount ?? 0) || 0;
        if(recordsStatsTotalConsume) recordsStatsTotalConsume.textContent = formatNumber(totalConsume);
        if(recordsStatsTotalInventory) recordsStatsTotalInventory.textContent = formatNumber(totalInventory);
        if(recordsStatsConsumeCount) recordsStatsConsumeCount.textContent = formatNumber(consumeCount);
        if(recordsStatsRestockCount) recordsStatsRestockCount.textContent = formatNumber(restockCount);
      }catch(e){
        toast(e?.message || "加载统计失败","error");
      }
    }

    function renderConsumeStats(items){
      const listEl = recordsStatsList;
      const emptyEl = recordsStatsEmpty;
      if(!listEl || !emptyEl) return { totalConsume: 0, codeCount: 0 };

      const normalized = (items||[]).map(it=>{
        const code = String(it?.code || "").toUpperCase();
        const qty = Number(it?.qty ?? it?.total ?? it?.consume ?? 0) || 0;
        if(!code || qty<=0) return null;
        const hex = COLORS[code] || MASTER_HEX[code] || it?.hex || "#777777";
        return {code, qty, hex};
      }).filter(Boolean)
        .sort((a,b)=> (b.qty-a.qty) || sortCodes(a.code, b.code));

      const total = normalized.reduce((acc, it)=> acc + (Number(it.qty)||0), 0);

      listEl.innerHTML = "";
      if(normalized.length===0){
        emptyEl.style.display="block";
        return { totalConsume: 0, codeCount: 0 };
      }
      emptyEl.style.display="none";

      normalized.forEach((it, idx)=>{
        const row = document.createElement("div");
        row.className = "stats-row";

        const cRank = document.createElement("div");
        cRank.className = "num";
        cRank.textContent = String(idx + 1);

        const cCode = document.createElement("div");
        cCode.className = "stats-code";
        const dot = document.createElement("span");
        dot.className = "stats-dot";
        dot.style.background = it.hex || "#777777";
        const txt = document.createElement("span");
        txt.textContent = it.code;
        cCode.appendChild(dot);
        cCode.appendChild(txt);

        const cQty = document.createElement("div");
        cQty.className = "num";
        cQty.textContent = String(it.qty);

        const cRemain = document.createElement("div");
        cRemain.className = "num";
        const remain = Number(INVENTORY?.[it.code] ?? 0);
        cRemain.textContent = Number.isFinite(remain) ? String(remain) : "0";

        row.appendChild(cRank);
        row.appendChild(cCode);
        row.appendChild(cQty);
        row.appendChild(cRemain);
        listEl.appendChild(row);
      });
      return { totalConsume: total, codeCount: normalized.length };
    }

    function renderRecordGroups(type, groups, options){
      const opts = options || {};
      const append = !!opts.append;
      const listEl = type==="consume" ? recordsConsumeList : recordsRestockList;
      const emptyEl = type==="consume" ? recordsConsumeEmpty : recordsRestockEmpty;
      if(!listEl || !emptyEl) return;

      // 顶部统计（仅消耗记录）
      if(type==="consume" && recordsConsumeTotalChip){
        if(!append) RECORDS_STATE.consumeTotal = 0;
        const sum = (groups||[]).reduce((acc,g)=>{
          const v = Number(g?.total ?? g?.sum ?? g?.totalQty ?? 0) || 0;
          return acc + v;
        }, 0);
        RECORDS_STATE.consumeTotal += sum;
        recordsConsumeTotalChip.textContent = `总消耗：${RECORDS_STATE.consumeTotal}`;
      }

      if(!append){
        listEl.innerHTML = "";
      }
      const existingSentinel = listEl.querySelector(".list-sentinel");
      if(existingSentinel) existingSentinel.remove();

      if(!groups || groups.length===0){
        if(!append){
          emptyEl.style.display="block";
          if(type==="consume"){
            emptyEl.innerHTML = `<div class="empty-illus"></div><div class="empty-text">暂无消耗记录</div>`;
          }else if(type==="restock"){
            emptyEl.innerHTML = `<div class="empty-illus"></div><div class="empty-text">暂无补充记录</div>`;
          }else{
            emptyEl.textContent = "暂无记录";
          }
        }
        ensureRecordSentinel(listEl);
        return;
      }
      emptyEl.style.display="none";
      if(type==="consume"){
        emptyEl.innerHTML = "";
      }

      for(const g of groups){
        const gid = String(g.gid ?? g.id ?? "");
        const ts = g.ts ?? g.created_at ?? g.createdAt ?? g.time ?? "";
        const pattern = String(g.pattern ?? "");
        const patternCategoryId = g.patternCategoryId ?? g.pattern_category_id ?? null;
        const patternUrlRaw = g.patternUrl ?? g.pattern_url;
        const patternUrl = (patternUrlRaw === null || patternUrlRaw === undefined) ? "" : String(patternUrlRaw).trim();
        const patternClean = (pattern==="手动调整") ? "" : pattern;
        const total = Number(g.total ?? g.sum ?? g.totalQty ?? 0) || 0;
        if(type === "consume" && g?.workId){
          RECORDS_STATE.workMap.set(gid, g);
          WORK_PUBLISHED_GIDS.add(gid);
        }

          const tpText = formatTimeMinuteString(ts);
        const k = _recKey(type, gid);
        const expanded = RECORDS_STATE.expanded.has(k);

        const btnEdit = document.createElement("button");
        btnEdit.type="button";
        btnEdit.className="link-action";
        btnEdit.textContent="编辑";
        btnEdit.addEventListener("click", ()=>openRecordEdit(type, gid, pattern, patternUrl, patternCategoryId));

        const btnToggle = document.createElement("button");
        btnToggle.type="button";
        btnToggle.className="link-action record-toggle-btn";
        setRecordToggleButton(btnToggle, expanded);

        const detail = document.createElement("div");
        detail.className="record-detail";
        detail.style.display = expanded ? "" : "none";

        btnToggle.addEventListener("click", async ()=>{
          const nowExp = RECORDS_STATE.expanded.has(k);
          if(nowExp){
            RECORDS_STATE.expanded.delete(k);
            setRecordToggleButton(btnToggle, false);
            detail.style.display="none";
          }else{
            RECORDS_STATE.expanded.add(k);
            setRecordToggleButton(btnToggle, true);
            detail.style.display="";
            await ensureRecordDetail(type, gid, detail);
          }
        });

        if(type==="consume"){
          const card = document.createElement("div");
          card.className = "record-card";
          card.dataset.gid = gid;

          const thumb = document.createElement("div");
          thumb.className = "record-thumb";
          thumb.setAttribute("aria-hidden","true");
          const icon = document.createElement("span");
          icon.className = "consume-thumb-icon";
          icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke-linecap="round"/></svg>';
          thumb.appendChild(icon);
          if(patternUrl){
            const img = document.createElement("img");
            img.src = RECORDS_IMG_PLACEHOLDER;
            img.dataset.src = patternUrl;
            img.alt = patternClean ? patternClean : "图纸";
            img.loading = "lazy";
            img.addEventListener("error", ()=>{
              img.remove();
              thumb.classList.remove("has-image");
            });
            thumb.classList.add("has-image");
            thumb.appendChild(img);
          }

          const main = document.createElement("div");
          main.className = "record-main";

          const head = document.createElement("div");
          head.className = "record-head";

          const title = document.createElement("div");
          title.className = "record-title";
          title.textContent = patternClean || "未命名图纸";
          if(!patternClean) title.classList.add("is-empty");
          head.appendChild(title);

          const metaLine = document.createElement("div");
          metaLine.className = "record-meta-line";

          const cTime = document.createElement("div");
          cTime.className = "record-time record-meta-item";
          cTime.innerHTML = `<span class="meta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span><span class="meta-text">${escapeHtml(tpText)}</span>`;

          const totalText = document.createElement("div");
          totalText.className = "record-total record-meta-item";
          totalText.innerHTML = `<span class="meta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3.5"></circle></svg></span><span class="meta-text">${escapeHtml(formatNumber(total))}</span>`;

          metaLine.appendChild(cTime);
          metaLine.appendChild(totalText);

        const actions = document.createElement("div");
        actions.className="record-actions";
        const btnPublish = document.createElement("button");
        btnPublish.type="button";
        btnPublish.className="link-action publish-btn";
        const published = !!(g?.workId || g?.workPublished || g?.published) || WORK_PUBLISHED_GIDS.has(gid);
        setPublishButtonState(btnPublish, published);
        btnPublish.addEventListener("click", ()=>{
          if(btnPublish.disabled) return;
          openWorkDialog(gid, btnPublish);
        });
        actions.appendChild(btnEdit);
        actions.appendChild(btnPublish);
        actions.appendChild(btnToggle);

          if(patternCategoryId){
            const catName = getPatternCategoryNameById(patternCategoryId);
            if(catName){
              const tag = document.createElement("div");
              tag.className = "pattern-tag";
              tag.textContent = catName;
              head.appendChild(tag);
            }
          }

          main.appendChild(head);
          main.appendChild(metaLine);
          main.appendChild(actions);

          card.appendChild(thumb);
          card.appendChild(main);
          card.appendChild(detail);
          listEl.appendChild(card);
        }else{
          const card = document.createElement("div");
          card.className = "record-card";
          card.dataset.gid = gid;

          const thumb = document.createElement("div");
          thumb.className = "record-thumb";
          thumb.setAttribute("aria-hidden","true");
          const icon = document.createElement("span");
          icon.className = "restock-thumb-icon";
          icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke-linecap="round"/><path d="M12 6v12" stroke-linecap="round"/></svg>';
          thumb.appendChild(icon);

          const main = document.createElement("div");
          main.className = "record-main";

          const title = document.createElement("div");
          title.className = "record-title";
          title.textContent = "补充库存";

          const metaLine = document.createElement("div");
          metaLine.className = "record-meta-line";

          const cTime = document.createElement("div");
          cTime.className = "record-time record-meta-item";
          cTime.innerHTML = `<span class="meta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span><span class="meta-text">${escapeHtml(tpText)}</span>`;

          const totalText = document.createElement("div");
          totalText.className = "record-total record-meta-item";
          totalText.innerHTML = `<span class="meta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3.5"></circle></svg></span><span class="meta-text">${escapeHtml(formatNumber(total))}</span>`;

          metaLine.appendChild(cTime);
          metaLine.appendChild(totalText);

        const actions = document.createElement("div");
        actions.className="record-actions";
        actions.appendChild(btnEdit);
        actions.appendChild(btnToggle);

          main.appendChild(title);
          main.appendChild(metaLine);
          main.appendChild(actions);

          card.appendChild(thumb);
          card.appendChild(main);
          card.appendChild(detail);
          listEl.appendChild(card);
        }

        if(expanded){
          ensureRecordDetail(type, gid, detail);
        }
      }
      ensureRecordSentinel(listEl);
      observeRecordImages(listEl);
    }

    async function loadAndRenderTodoList(){
      if(!todoList || !todoEmpty) return;
      try{
        const categoryParam = TODO_ACTIVE_CATEGORY_ID ? `?patternCategoryId=${encodeURIComponent(TODO_ACTIVE_CATEGORY_ID)}` : "";
        const res = await apiGet(`/api/todoPatterns${categoryParam}`);
        const items = Array.isArray(res.data) ? res.data : [];
        renderTodoList(items);
      }catch(e){
        toast(e?.message || "加载待拼图纸失败","error");
      }
    }

    function renderTodoList(items){
      if(!todoList || !todoEmpty) return;
      todoList.innerHTML = "";
      if(!items || items.length===0){
        todoEmpty.style.display = "block";
        todoEmpty.innerHTML = `<div class="empty-illus"></div><div class="empty-text">暂无图纸记录</div>`;
        return;
      }
      todoEmpty.style.display = "none";
      todoEmpty.innerHTML = "";

      for(const g of items){
        const gid = String(g.id ?? g.gid ?? "");
        const ts = g.ts ?? g.created_at ?? g.createdAt ?? g.time ?? "";
        const pattern = String(g.pattern ?? "");
        const patternCategoryId = g.patternCategoryId ?? g.pattern_category_id ?? null;
        const patternUrlRaw = g.patternUrl ?? g.pattern_url;
        const patternUrl = (patternUrlRaw === null || patternUrlRaw === undefined) ? "" : String(patternUrlRaw).trim();
        const patternClean = (pattern==="手动调整") ? "" : pattern;
        const total = Number(g.total ?? g.sum ?? g.totalQty ?? 0) || 0;

        const tpText = formatTimeMinuteString(ts);
        const btnDone = document.createElement("button");
        btnDone.type="button";
        btnDone.className="link-action btn-todo-done";
        btnDone.textContent="已拼完";
        btnDone.addEventListener("click", ()=>{
          openTodoCompleteConfirm(gid);
        });

        const btnEdit = document.createElement("button");
        btnEdit.type="button";
        btnEdit.className="link-action";
        btnEdit.textContent="编辑";
        btnEdit.addEventListener("click", ()=>openRecordEdit("todo", gid, pattern, patternUrl, patternCategoryId));

        const card = document.createElement("div");
        card.className = "record-card";
        card.dataset.gid = gid;

        const thumb = document.createElement("div");
        thumb.className = "record-thumb";
        thumb.setAttribute("aria-hidden","true");
        const icon = document.createElement("span");
        icon.className = "consume-thumb-icon";
        icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke-linecap="round"/></svg>';
        thumb.appendChild(icon);
        if(patternUrl){
          const img = document.createElement("img");
          img.src = patternUrl;
          img.alt = patternClean ? patternClean : "图纸";
          img.loading = "lazy";
          img.addEventListener("error", ()=>{
            img.remove();
            thumb.classList.remove("has-image");
          });
          thumb.classList.add("has-image");
          thumb.appendChild(img);
        }

        const main = document.createElement("div");
        main.className = "record-main";

        const head = document.createElement("div");
        head.className = "record-head";

        const title = document.createElement("div");
        title.className = "record-title";
        title.textContent = patternClean || "未命名图纸";
        if(!patternClean) title.classList.add("is-empty");
        head.appendChild(title);

        if(patternCategoryId){
          const catName = getPatternCategoryNameById(patternCategoryId);
          if(catName){
            const tag = document.createElement("div");
            tag.className = "pattern-tag";
            tag.textContent = catName;
            head.appendChild(tag);
          }
        }

        const metaLine = document.createElement("div");
        metaLine.className = "record-meta-line";

        const cTime = document.createElement("div");
        cTime.className = "record-time record-meta-item";
        cTime.innerHTML = `<span class="meta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span><span class="meta-text">${escapeHtml(tpText)}</span>`;

        const totalText = document.createElement("div");
        totalText.className = "record-total record-meta-item";
        totalText.innerHTML = `<span class="meta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3.5"></circle></svg></span><span class="meta-text">${escapeHtml(formatNumber(total))}</span>`;

        metaLine.appendChild(cTime);
        metaLine.appendChild(totalText);

        const actions = document.createElement("div");
        actions.className="record-actions";
        actions.appendChild(btnEdit);
        actions.appendChild(btnDone);

        main.appendChild(head);
        main.appendChild(metaLine);
        main.appendChild(actions);

        card.appendChild(thumb);
        card.appendChild(main);
        todoList.appendChild(card);
      }
    }

    function formatWorkDuration(item){
      const minutes = Number(item?.durationMinutes ?? item?.duration_minutes ?? 0) || 0;
      if(minutes > 0) return formatDurationMinutes(minutes);
      const raw = (item?.duration || "").trim();
      return raw || "—";
    }

    function resetWorksPaging(){
      WORKS_STATE.cursor = null;
      WORKS_STATE.hasMore = true;
      WORKS_STATE.loading = false;
      WORKS_STATE.requestSeq = 0;
      WORKS_STATE.cacheKey = "";
      WORKS_STATE.list = [];
      if(worksList) worksList.innerHTML = "";
    }

    async function fetchWorksPage({reset}){
      if(!worksList || !worksEmpty) return;
      if(!IS_LOGGED_IN){
        if(APP_READY) toast("请登录后查看作品","warn");
        return;
      }
      const categoryParam = WORKS_STATE.categoryId ? String(WORKS_STATE.categoryId) : "";
      const key = `${categoryParam || ""}`;
      if(reset || WORKS_STATE.cacheKey !== key){
        WORKS_STATE.cacheKey = key;
        resetWorksPaging();
        reset = true;
      }
      if(WORKS_STATE.loading) return;
      if(!reset && !WORKS_STATE.hasMore) return;

      const params = new URLSearchParams();
      if(categoryParam) params.set("patternCategoryId", categoryParam);
      params.set("limit", String(WORKS_STATE.pageSize));
      if(!reset && WORKS_STATE.cursor){
        params.set("cursor", String(WORKS_STATE.cursor));
      }
      const url = `/api/works?${params.toString()}`;
      const seq = ++WORKS_STATE.requestSeq;
      WORKS_STATE.loading = true;
      try{
        const res = await apiGet(url);
        if(seq !== WORKS_STATE.requestSeq) return;
        const items = Array.isArray(res?.data) ? res.data : [];
        const hasMore = !!res?.hasMore;
        const nextCursor = res?.nextCursor ? String(res.nextCursor) : null;
        WORKS_STATE.cursor = nextCursor || null;
        WORKS_STATE.hasMore = hasMore && !!nextCursor;
        if(reset) WORKS_STATE.list = [];
        WORKS_STATE.list = WORKS_STATE.list.concat(items);
        renderWorksList(WORKS_STATE.list);
      }catch(e){
        toast(e?.message || "加载作品失败","error");
      }finally{
        if(seq === WORKS_STATE.requestSeq) WORKS_STATE.loading = false;
      }
    }

    async function loadWorksSummary(){
      if(!worksTotalCount || !worksTotalConsume || !worksTotalDuration) return;
      if(!IS_LOGGED_IN) return;
      try{
        const params = new URLSearchParams();
        if(WORKS_STATE.categoryId) params.set("patternCategoryId", String(WORKS_STATE.categoryId));
        const url = params.toString() ? `/api/worksSummary?${params.toString()}` : "/api/worksSummary";
        const res = await apiGet(url);
        const data = res?.data || res || {};
        const totalCount = Number(data?.totalCount ?? 0) || 0;
        const totalConsume = Number(data?.totalConsume ?? 0) || 0;
        const totalMinutes = Number(data?.totalDurationMinutes ?? 0) || 0;
        worksTotalCount.textContent = formatNumber(totalCount);
        worksTotalConsume.textContent = formatNumber(totalConsume);
        worksTotalDuration.textContent = totalMinutes > 0 ? formatDurationShort(totalMinutes) : "0min";
      }catch(e){
        toast(e?.message || "加载作品统计失败","error");
      }
    }

    let worksMasonryRaf = null;
    function scheduleWorksMasonry(){
      if(!worksList) return;
      if(worksList.classList.contains("is-empty")) return;
      if(worksMasonryRaf) cancelAnimationFrame(worksMasonryRaf);
      worksMasonryRaf = requestAnimationFrame(()=>{
        worksMasonryRaf = null;
        layoutWorksMasonry();
      });
    }

    function layoutWorksMasonry(){
      if(!worksList) return;
      if(worksList.classList.contains("is-empty")) return;
      const rowHeight = 8;
      const styles = getComputedStyle(worksList);
      const gap = parseFloat(styles.rowGap || styles.gap || "0") || 0;
      const cards = worksList.querySelectorAll(".work-card");
      cards.forEach(card=>{
        card.style.gridRowEnd = "auto";
      });
      cards.forEach(card=>{
        const height = card.getBoundingClientRect().height;
        const span = Math.max(1, Math.ceil((height + gap) / (rowHeight + gap)));
        card.style.gridRowEnd = `span ${span}`;
      });
    }

    function renderWorksList(items){
      if(!worksList || !worksEmpty) return;
      worksList.innerHTML = "";
      const list = Array.isArray(items) ? items : [];
      const hasFilter = !!WORKS_STATE.categoryId;
      const hasCategories = (PATTERN_CATEGORIES || []).length > 0;
      if(list.length === 0){
        if(hasFilter){
          worksList.classList.add("is-empty");
          worksEmpty.style.display = "none";
          if(worksStats) worksStats.style.display = "";
          if(worksCategoryBar) worksCategoryBar.style.display = hasCategories ? "" : "none";
          const empty = document.createElement("div");
          empty.className = "works-list-empty";
          empty.innerHTML = `<div class="empty-illus"></div><div class="empty-text">暂无作品</div>`;
          worksList.appendChild(empty);
        }else{
          worksList.classList.remove("is-empty");
          worksEmpty.style.display = "block";
          if(worksStats) worksStats.style.display = "none";
          if(worksCategoryBar) worksCategoryBar.style.display = "none";
        }
        return;
      }
      worksList.classList.remove("is-empty");
      worksEmpty.style.display = "none";
      if(worksStats) worksStats.style.display = "";
      if(worksCategoryBar) worksCategoryBar.style.display = hasCategories ? "" : "none";

      list.forEach(item=>{
        const card = document.createElement("div");
        card.className = "work-card";
        card.dataset.id = String(item.workId || item.id || "");
        if(item.gid){
          WORK_PUBLISHED_GIDS.add(String(item.gid));
        }
        const img = document.createElement("img");
        img.src = String(item.imageUrl || item.image_url || "");
        img.alt = String(item.pattern || "作品");
        img.addEventListener("load", scheduleWorksMasonry);
        img.addEventListener("error", scheduleWorksMasonry);
        card.appendChild(img);

        const body = document.createElement("div");
        body.className = "work-card-body";
        const head = document.createElement("div");
        head.className = "work-card-head";
        const title = document.createElement("div");
        title.className = "work-card-title";
        title.textContent = item.pattern || "未命名图纸";
        head.appendChild(title);
        const meta = document.createElement("div");
        meta.className = "work-card-meta";
        const time = document.createElement("div");
        time.className = "meta-item";
        const dateText = formatDateOnly(item.finishedAt || item.finished_at || item.ts || "");
        time.innerHTML = `<span class="meta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span><span>${escapeHtml(dateText)}</span>`;
        const total = document.createElement("div");
        total.className = "meta-item";
        total.innerHTML = `<span class="meta-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3.5"></circle></svg></span><span>${escapeHtml(formatNumber(item.total || 0))}</span>`;
        meta.appendChild(time);
        meta.appendChild(total);
        body.appendChild(head);
        body.appendChild(meta);

        const catName = item?.patternCategoryId ? getPatternCategoryNameById(item.patternCategoryId) : "";
        if(catName){
          const tag = document.createElement("div");
          tag.className = "pattern-tag work-card-tag";
          tag.textContent = catName;
          card.appendChild(tag);
        }
        card.appendChild(body);
        card.addEventListener("click", ()=>openWorkDetail(item));
        worksList.appendChild(card);
      });
      scheduleWorksMasonry();
    }

    async function loadAndRenderWorks(){
      if(!IS_LOGGED_IN){
        if(APP_READY) toast("请登录后查看作品","warn");
        return;
      }
      renderWorksCategoryTabs();
      await Promise.all([loadWorksSummary(), fetchWorksPage({reset:true})]);
    }

    function openWorkDetail(item){
      if(!workDetailDialog) return;
      const pattern = item?.pattern || "未命名图纸";
      const catName = item?.patternCategoryId ? getPatternCategoryNameById(item.patternCategoryId) : "";
      const finishedAt = formatTimeMinuteString(item?.finishedAt || item?.finished_at || item?.ts || "");
      const total = formatNumber(item?.total || 0);
      const duration = formatWorkDuration(item);
      const note = (item?.note || "").trim();

      if(workDetailImageWrap) workDetailImageWrap.classList.remove("is-loaded");
      if(workDetailImage) workDetailImage.src = String(item?.imageUrl || item?.image_url || "");
      if(workDetailTitle) workDetailTitle.textContent = pattern;
      if(workDetailTag){
        if(catName){
          workDetailTag.textContent = catName;
          workDetailTag.style.display = "";
        }else{
          workDetailTag.textContent = "";
          workDetailTag.style.display = "none";
        }
      }
      if(workDetailStats){
        workDetailStats.innerHTML = "";
        const items = [
          {label:"拼豆时长", value: duration || "—"},
          {label:"拼豆数量", value: total}
        ];
        items.forEach(r=>{
          const div = document.createElement("div");
          div.className = "work-detail-stat";
          div.innerHTML = `<span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong>`;
          workDetailStats.appendChild(div);
        });
      }
      if(workDetailTime){
        workDetailTime.innerHTML = "";
        const timeText = finishedAt || "—";
        workDetailTime.innerHTML = `<span>完成时间</span><strong>${escapeHtml(timeText)}</strong>`;
      }
      if(workDetailNotes){
        workDetailNotes.textContent = note || "暂无备注";
      }
      WORK_STATE.editItem = item;
      openDialog(workDetailDialog);
    }

    function openWorkEdit(item){
      if(!item) return;
      openWorkDialog(String(item.gid || ""), null);
      WORK_STATE.editId = String(item.workId || item.id || "");
      WORK_STATE.editItem = item;
      if(workDialogDelete) workDialogDelete.style.display = "inline-flex";
      if(workDialog){
        const title = workDialog.querySelector(".modal-head h3");
        if(title) title.textContent = "编辑作品";
      }
      updateWorkPreview(String(item?.imageUrl || item?.image_url || ""));
      if(workFinishedAtInput){
        const dt = item?.finishedAt || item?.finished_at || "";
        if(dt){
          const s = formatTimeMinuteString(dt).replace(" ", "T");
          workFinishedAtInput.value = s;
        }
      }
      const mins = Number(item?.durationMinutes ?? item?.duration_minutes ?? 0) || 0;
      if(workDurationHours) workDurationHours.value = String(Math.floor(mins / 60));
      if(workDurationMinutes) workDurationMinutes.value = String(mins % 60);
      if(workNoteInput) workNoteInput.value = String(item?.note || "");
      if(workDialogSave) workDialogSave.disabled = false;
    }

    async function ensureRecordDetail(type, gid, container){
      const key = _recKey(type, gid);
      if(RECORDS_STATE.detailCache.has(key)){
        renderRecordDetail(container, RECORDS_STATE.detailCache.get(key));
        return;
      }
      container.innerHTML = "<div class='help'>加载中...</div>";
      try{
        const res = await apiGet(`/api/recordGroupDetail?gid=${encodeURIComponent(gid)}&type=${encodeURIComponent(type)}`);
        const items = Array.isArray(res.data) ? res.data : [];
        items.sort((a,b)=> (Number(b.qty||0)-Number(a.qty||0)) || sortCodes(String(a.code||""), String(b.code||"")));
        RECORDS_STATE.detailCache.set(key, items);
        renderRecordDetail(container, items);
      }catch(e){
        const msg = (e && e.message) ? String(e.message) : "";
        container.innerHTML = "<div class='help'>加载明细失败" + (msg ? ("：" + escapeHtml(msg)) : "") + "</div>";
      }
    }

    function renderRecordDetail(container, items){
      container.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "record-pill-wrap";
      const grid = document.createElement("div");
      grid.className = "record-pill-grid";

      if(!items || items.length===0){
        const empty = document.createElement("div");
        empty.className="help";
        empty.textContent="无明细";
        wrap.appendChild(empty);
      }else{
        for(const it of items){
          const code = String(it.code||"").toUpperCase();
          const qty = Number(it.qty||0) || 0;

          const pill = document.createElement("div");
          pill.className="record-pill";

          const dot = document.createElement("div");
          dot.className="record-dot";
          dot.style.background = (COLORS[code] || it.hex || "#777777");

          const txt = document.createElement("div");
          txt.className="record-pill-text";
          txt.textContent = `${code} ${qty}`;

          pill.appendChild(dot);
          pill.appendChild(txt);
          grid.appendChild(pill);
        }
        wrap.appendChild(grid);
      }
      container.appendChild(wrap);
    }

    function fillRecordEditRows(items){
      // Edit uses aggregated per-code items (same as detail view).
      if(!recordEditRows) return;
      recordEditRows.innerHTML = "";
      const list = Array.isArray(items) ? items.slice() : [];
      if(list.length===0){
        createManualRow(recordEditRows);
        return;
      }
      list.sort((a,b)=> (Number(b.qty||0)-Number(a.qty||0)) || sortCodes(String(a.code||""), String(b.code||"")));
      list.forEach(it=>{
        const row = createManualRow(recordEditRows);
        const inputs = row ? row.querySelectorAll("input") : [];
        if(inputs[0]) inputs[0].value = String(it.code||"").trim().toUpperCase();
        if(inputs[1]) inputs[1].value = String(Number(it.qty||0) || "");
      });
    }

    let RECORD_EDIT_ALLOW_REMOVE = true;
    const RECORD_EDIT_IMAGE = {
      originalUrl: "",
      file: null,
      previewUrl: "",
      removed: false,
      changed: false
    };
    function clearRecordEditPreviewUrl(){
      if(RECORD_EDIT_IMAGE.previewUrl){
        URL.revokeObjectURL(RECORD_EDIT_IMAGE.previewUrl);
        RECORD_EDIT_IMAGE.previewUrl = "";
      }
    }
    function updateRecordEditImageUI(){
      if(!recordEditImageName || !recordEditImagePreview || !recordEditImagePreviewImg) return;
      const hasFile = !!RECORD_EDIT_IMAGE.file;
      const showUrl = hasFile
        ? RECORD_EDIT_IMAGE.previewUrl
        : (RECORD_EDIT_IMAGE.removed ? "" : RECORD_EDIT_IMAGE.originalUrl);
      if(showUrl){
        recordEditImagePreview.style.display = "flex";
        recordEditImagePreviewImg.src = showUrl;
      }else{
        recordEditImagePreview.style.display = "none";
        recordEditImagePreviewImg.removeAttribute("src");
      }
      if(hasFile){
        recordEditImageName.textContent = RECORD_EDIT_IMAGE.file.name || "已选择图纸";
      }else if(RECORD_EDIT_IMAGE.originalUrl && !RECORD_EDIT_IMAGE.removed){
        recordEditImageName.textContent = "已上传图纸";
      }else{
        recordEditImageName.textContent = "未选择图纸";
      }
      if(recordEditImageClear){
        const canClear = hasFile || (!!RECORD_EDIT_IMAGE.originalUrl && !RECORD_EDIT_IMAGE.removed);
        recordEditImageClear.disabled = !canClear || !RECORD_EDIT_ALLOW_REMOVE;
        recordEditImageClear.style.display = (canClear && RECORD_EDIT_ALLOW_REMOVE) ? "" : "none";
      }
    }
    function resetRecordEditImage(url){
      if(recordEditImageInput) recordEditImageInput.value = "";
      clearRecordEditPreviewUrl();
      RECORD_EDIT_IMAGE.originalUrl = String(url || "");
      RECORD_EDIT_IMAGE.file = null;
      RECORD_EDIT_IMAGE.removed = false;
      RECORD_EDIT_IMAGE.changed = false;
      updateRecordEditImageUI();
    }

    async function openRecordEdit(type, gid, pattern, patternUrl, patternCategoryId){
      if(!recordEditDialog) return;
      RECORDS_STATE.pendingEdit = {type, gid, categoryId: (patternCategoryId === null || patternCategoryId === undefined) ? null : String(patternCategoryId)};
      const isConsumeLike = (type === "consume" || type === "todo");
      RECORD_EDIT_ALLOW_REMOVE = (type !== "todo");
      if(recordEditTitle){
        recordEditTitle.textContent = type==="consume"
          ? "编辑消耗记录"
          : (type==="todo" ? "编辑待拼图纸" : "编辑补充记录");
      }
      if(recordEditDelete){
        recordEditDelete.textContent = "删除记录";
        recordEditDelete.style.display = "inline-flex";
      }
      if(recordEditPatternField) recordEditPatternField.style.display = isConsumeLike ? "" : "none";
      if(recordEditCategoryField) recordEditCategoryField.style.display = isConsumeLike ? "" : "none";
      if(recordEditImageField) recordEditImageField.style.display = isConsumeLike ? "" : "none";
      if(recordEditPatternInput){
        const p = (pattern==="手动调整") ? "" : String(pattern||"");
        recordEditPatternInput.value = p;
      }
      if(recordEditCategorySelect){
        recordEditCategorySelect.value = RECORDS_STATE.pendingEdit?.categoryId || "";
      }
      if(isConsumeLike) resetRecordEditImage(patternUrl || "");
      else resetRecordEditImage("");
      if(recordEditRows) recordEditRows.innerHTML = "<div class='help'>加载中...</div>";
      openDialog(recordEditDialog);

      const key = _recKey(type, gid);
      let items = RECORDS_STATE.detailCache.get(key);
      if(!items){
        try{
          if(type === "todo"){
            const res = await apiGet(`/api/todoPatternDetail?id=${encodeURIComponent(gid)}`);
            items = Array.isArray(res.data) ? res.data : [];
          }else{
            const res = await apiGet(`/api/recordGroupDetail?gid=${encodeURIComponent(gid)}&type=${encodeURIComponent(type)}`);
            items = Array.isArray(res.data) ? res.data : [];
          }
          RECORDS_STATE.detailCache.set(key, items);
        }catch(e){
          toast(e?.message || "加载明细失败","error");
          items = [];
        }
      }
      fillRecordEditRows(items);
    }

    function closeRecordEditDialog(){
      closeDialog(recordEditDialog);
      RECORDS_STATE.pendingEdit = null;
      RECORD_EDIT_ALLOW_REMOVE = true;
      resetRecordEditImage("");
      if(recordEditDelete) recordEditDelete.style.display = "none";
    }

    async function doRecordEdit(){
      const p = RECORDS_STATE.pendingEdit;
      if(!p) return;
      if(recordEditConfirm && recordEditConfirm.disabled) return;
      if(recordEditConfirm) recordEditConfirm.disabled = true;
      try{
        const rows = Array.from(recordEditRows?.querySelectorAll(".record-row") || []);
        if(rows.length===0){ toast("请至少添加一条记录","error"); return; }
        const items = [];
        for(const row of rows){
          const inputs = row.querySelectorAll("input");
          const code = (inputs[0]?.value || "").trim().toUpperCase();
          const qtyStr = (inputs[1]?.value || "").trim();
          if(!code && !qtyStr) continue;
          const validMap = (p.type === "todo") ? MASTER_HEX : COLORS;
          if(!code || !validMap[code]){ toast("存在空的色号或无效色号","error"); return; }
          const qty = Number(qtyStr);
          if(!Number.isInteger(qty) || qty<=0){ toast("存在无效数量（必须为正整数）","error"); return; }
          items.push({code, qty});
        }
        if(items.length===0){ toast("请至少添加一条记录","error"); return; }

        if(p.type==="todo"){
          const pattern = (recordEditPatternInput?.value || "").trim();
          if(pattern.length>20){ toast("图纸名称不超过 20 字","error"); return; }
          const payload = {id: p.gid, items};
          payload.pattern = pattern || null;
          if(p.categoryId !== undefined){
            payload.patternCategoryId = p.categoryId || null;
          }
          if(RECORD_EDIT_IMAGE.changed){
            if(RECORD_EDIT_IMAGE.removed){
              toast("待拼图纸必须保留图片","error");
              return;
            }else if(RECORD_EDIT_IMAGE.file){
              const uploaded = await uploadPatternImage(RECORD_EDIT_IMAGE.file);
              payload.patternUrl = uploaded?.cdnUrl || null;
              payload.patternKey = uploaded?.objectKey || null;
            }
          }
          await apiPost("/api/todoPatternUpdate", payload);
          closeRecordEditDialog();
          await loadAndRenderTodoList();
          toast("保存成功","success");
          return;
        }

        const payload = {gid: p.gid, type: p.type, items};
        if(p.type==="consume"){
          const pattern = (recordEditPatternInput?.value || "").trim();
          if(pattern.length>20){ toast("图纸名称不超过 20 字","error"); return; }
          payload.pattern = pattern || null;
          if(p.categoryId !== undefined){
            payload.patternCategoryId = p.categoryId || null;
          }
          if(RECORD_EDIT_IMAGE.changed){
            if(RECORD_EDIT_IMAGE.removed){
              payload.patternUrl = null;
              payload.patternKey = null;
            }else if(RECORD_EDIT_IMAGE.file){
              const uploaded = await uploadPatternImage(RECORD_EDIT_IMAGE.file);
              payload.patternUrl = uploaded?.cdnUrl || null;
              payload.patternKey = uploaded?.objectKey || null;
            }
          }
        }

        await apiPost("/api/recordGroupUpdate", payload);
        closeRecordEditDialog();
        RECORDS_STATE.detailCache.clear();
        RECORDS_STATE.expanded.clear();
        await syncAll();
        await loadAndRenderRecordGroups();
        toast("保存成功","success");
      }catch(e){
        toast(e?.message || "保存失败","error");
      }finally{
        if(recordEditConfirm) recordEditConfirm.disabled = false;
      }
    }

    function openRecordDeleteConfirm(type, gid){
      const hasWork = type === "consume" && RECORDS_STATE.workMap.has(String(gid || ""));
      let message = type==="consume"
        ? "删除会补回已扣减的拼豆库存，是否确认删除"
        : "删除会减掉已补充的拼豆库存，是否确认删除";
      if(hasWork){
        message += "\n该记录已发布作品，删除记录会同时删除作品。";
      }
      openConfirmDialog({
        title: "删除记录",
        text: message,
        confirmLabel: "确认删除",
        confirmClass: "btn-danger",
        onConfirm: async ()=>{
          try{
            if(confirmDialogConfirm) confirmDialogConfirm.disabled = true;
            await apiPost("/api/recordGroupDelete", {gid, type});
            closeConfirmDialog();
            RECORDS_STATE.detailCache.clear();
            RECORDS_STATE.expanded.clear();
            await syncAll();
            await loadAndRenderRecordGroups();
            toast("删除成功","success");
          }catch(e){
            if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
            toast(e?.message || "删除失败","error");
          }
        }
      });
    }

    function openTodoDeleteConfirm(gid){
      openConfirmDialog({
        title: "删除记录",
        text: "删除会移除待拼图纸记录，是否确认删除",
        confirmLabel: "确认删除",
        confirmClass: "btn-danger",
        onConfirm: async ()=>{
          try{
            if(confirmDialogConfirm) confirmDialogConfirm.disabled = true;
            await apiPost("/api/todoPatternDelete", {id: gid});
            closeConfirmDialog();
            await loadAndRenderTodoList();
            toast("删除成功","success");
          }catch(e){
            if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
            toast(e?.message || "删除失败","error");
          }
        }
      });
    }

    function openTodoCompleteConfirm(gid){
      if(!gid) return;
      openConfirmDialog({
        title: "确认已拼完",
        text: "是否确认将图纸计入消耗？",
        confirmLabel: "确认",
        confirmClass: "btn-danger",
        onConfirm: async ()=>{
          try{
            if(confirmDialogConfirm) confirmDialogConfirm.disabled = true;
            await apiPost("/api/todoPatternComplete", {id: gid});
            closeConfirmDialog();
            await syncAll();
            await loadAndRenderTodoList();
            RECORDS_STATE.detailCache.clear();
            RECORDS_STATE.expanded.clear();
            if(RECORDS_STATE.active !== "stats"){
              await loadAndRenderRecordGroups();
            }
            toast("已转入消耗记录","success");
          }catch(e){
            if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
            toast(e?.message || "操作失败","error");
          }
        }
      });
    }

    if(recordsDialog){
      setRecordsTab(RECORDS_STATE.active);
    }
    if(recordEditClose) recordEditClose.addEventListener("click", closeRecordEditDialog);
    if(recordEditCancel) recordEditCancel.addEventListener("click", closeRecordEditDialog);
    if(recordEditConfirm) recordEditConfirm.addEventListener("click", doRecordEdit);
    if(recordEditDelete){
      recordEditDelete.addEventListener("click", ()=>{
        const p = RECORDS_STATE.pendingEdit;
        if(!p || !p.gid) return;
        closeRecordEditDialog();
        if(p.type === "todo") openTodoDeleteConfirm(p.gid);
        else openRecordDeleteConfirm(p.type, p.gid);
      });
    }
    if(recordEditImageInput){
      recordEditImageInput.addEventListener("change", ()=>{
        const file = recordEditImageInput.files?.[0];
        if(!file){
          updateRecordEditImageUI();
          return;
        }
        if(!isAllowedImageFile(file)){
          toast("仅支持 JPG/PNG/WebP 图片","error");
          recordEditImageInput.value = "";
          updateRecordEditImageUI();
          return;
        }
        clearRecordEditPreviewUrl();
        RECORD_EDIT_IMAGE.file = file;
        RECORD_EDIT_IMAGE.removed = false;
        RECORD_EDIT_IMAGE.changed = true;
        RECORD_EDIT_IMAGE.previewUrl = URL.createObjectURL(file);
        updateRecordEditImageUI();
      });
    }
    if(recordEditImageClear){
      recordEditImageClear.addEventListener("click", ()=>{
        if(recordEditImageInput) recordEditImageInput.value = "";
        clearRecordEditPreviewUrl();
        RECORD_EDIT_IMAGE.file = null;
        RECORD_EDIT_IMAGE.removed = true;
        RECORD_EDIT_IMAGE.changed = true;
        updateRecordEditImageUI();
      });
    }
    if(recordEditCategorySelect){
      recordEditCategorySelect.addEventListener("change", ()=>{
        if(RECORDS_STATE.pendingEdit && RECORDS_STATE.pendingEdit.type==="consume"){
          RECORDS_STATE.pendingEdit.categoryId = recordEditCategorySelect.value || null;
        }
      });
    }
    if(recordEditAddRow) recordEditAddRow.addEventListener("click", ()=>{
      const rows = recordEditRows?.querySelectorAll(".record-row") || [];
      if(rows.length>=100){ toast("一次最多添加 100 条记录","error"); return; }
      createManualRow(recordEditRows);
    });
    if(recordEditDialog && !recordEditDialog.__hooked){
      recordEditDialog.addEventListener("close", ()=>{
        RECORDS_STATE.pendingEdit = null;
        resetRecordEditImage("");
      });
      recordEditDialog.__hooked = true;
    }

    if(workDialogClose) workDialogClose.addEventListener("click", ()=>{ if(workDialog) closeDialog(workDialog); });
    if(workDialogCancel) workDialogCancel.addEventListener("click", ()=>{ if(workDialog) closeDialog(workDialog); });
    if(workDialogSave) workDialogSave.addEventListener("click", saveWork);
    if(workDialogDelete){
      workDialogDelete.addEventListener("click", ()=>{
        if(!WORK_STATE.editId) return;
        const workId = WORK_STATE.editId;
        const gid = String(WORK_STATE.editItem?.gid || WORK_STATE.gid || "");
        openConfirmDialog({
          title: "删除作品",
          text: "删除后无法恢复，是否确认删除？",
          confirmLabel: "确认删除",
          confirmClass: "btn-danger",
          onConfirm: async ()=>{
            try{
              if(confirmDialogConfirm) confirmDialogConfirm.disabled = true;
              await apiPost("/api/workDelete", {workId});
              closeConfirmDialog();
              if(gid){
                WORK_PUBLISHED_GIDS.delete(gid);
                const btn = document.querySelector(`.record-card[data-gid="${gid}"] .publish-btn`);
                if(btn) setPublishButtonState(btn, false);
              }
              if(document.body.dataset.page === "works"){
                await loadAndRenderWorks();
              }
              if(workDetailDialog && workDetailDialog.open) closeDialog(workDetailDialog);
              if(workDialog) closeDialog(workDialog);
              toast("作品已删除","success");
            }catch(e){
              if(confirmDialogConfirm) confirmDialogConfirm.disabled = false;
              toast(e?.message || "删除失败","error");
            }
          }
        });
      });
    }
    if(workDialog && !workDialog.__hooked){
      workDialog.addEventListener("close", ()=>{ resetWorkDialog(); });
      workDialog.__hooked = true;
    }
    if(workCropperDialog && !workCropperDialog.__hooked){
      workCropperDialog.addEventListener("cancel", (e)=>{
        e.preventDefault();
        e.stopImmediatePropagation();
      });
      workCropperDialog.addEventListener("close", ()=>{
        if(workDialog) workDialog.classList.remove("is-locked");
      });
      workCropperDialog.__hooked = true;
    }

    if(workUploadBox){
      workUploadBox.addEventListener("click", triggerWorkUpload);
      workUploadBox.addEventListener("keydown", (e)=>{
        if(e.key === "Enter" || e.key === " "){
          e.preventDefault();
          triggerWorkUpload();
        }
      });
    }
    if(workUploadReupload) workUploadReupload.addEventListener("click", triggerWorkUpload);
    if(workUploadInput){
      workUploadInput.addEventListener("change", ()=>{
        const file = workUploadInput.files?.[0];
        if(!file) return;
        if(!IS_LOGGED_IN){
          toast("请登录后发布作品","warn");
          workUploadInput.value = "";
          return;
        }
        if(!isAllowedImageFile(file)){
          toast("仅支持 JPG/PNG/WebP 图片","error");
          workUploadInput.value = "";
          return;
        }
        WORK_STATE.prevFile = WORK_STATE.croppedFile;
        WORK_STATE.croppedFile = null;
        if(workDialogSave) workDialogSave.disabled = true;
        startWorkCropper(file);
      });
    }
    if(workCropperZoom){
      workCropperZoom.addEventListener("input", ()=>{
        if(!WORK_STATE.cropper || !WORK_STATE.cropperReady) return;
        const scale = Number(workCropperZoom.value);
        if(Number.isFinite(scale)){
          const base = Number(WORK_STATE.cropperBaseRatio) || 1;
          WORK_STATE.cropper.zoomTo(base * scale);
        }
      });
    }
    if(workCropperImage && !workCropperImage.__zoomHooked){
      workCropperImage.addEventListener("zoom", (e)=>{
        if(!WORK_STATE.cropperReady) return;
        const ratio = Number(e?.detail?.ratio);
        if(workCropperZoom && Number.isFinite(ratio)){
          const base = Number(WORK_STATE.cropperBaseRatio) || 1;
          const scale = ratio / base;
          const clamped = Math.max(1, Math.min(3, scale));
          workCropperZoom.value = String(clamped);
        }
      });
      workCropperImage.__zoomHooked = true;
    }
    if(workCropperCancel) workCropperCancel.addEventListener("click", cancelWorkCrop);
    if(workCropperConfirm) workCropperConfirm.addEventListener("click", confirmWorkCrop);
    if(workFinishedAtWrap && workFinishedAtInput){
      workFinishedAtWrap.addEventListener("click", ()=>{
        if(typeof workFinishedAtInput.showPicker === "function"){
          workFinishedAtInput.showPicker();
        }else{
          workFinishedAtInput.focus();
        }
      });
    }
    if(workDurationHours){
      workDurationHours.addEventListener("blur", normalizeDurationInputs);
      workDurationHours.addEventListener("change", normalizeDurationInputs);
    }
    if(workDurationMinutes){
      workDurationMinutes.addEventListener("blur", normalizeDurationInputs);
      workDurationMinutes.addEventListener("change", normalizeDurationInputs);
    }
    if(workDetailClose) workDetailClose.addEventListener("click", ()=>{ if(workDetailDialog) closeDialog(workDetailDialog); });
    if(workDetailShare) workDetailShare.addEventListener("click", ()=>{ toast("敬请期待","info"); });
    if(workDetailEdit){
      workDetailEdit.addEventListener("click", ()=>{
        if(workDetailDialog && workDetailDialog.open) closeDialog(workDetailDialog);
        if(WORK_STATE.editItem) openWorkEdit(WORK_STATE.editItem);
      });
    }
    if(workDetailImage && !workDetailImage.__hooked){
      const wrap = workDetailImageWrap || workDetailImage.closest(".work-detail-image");
      const setLoaded = (val)=>{
        if(!wrap) return;
        wrap.classList.toggle("is-loaded", !!val);
      };
      workDetailImage.addEventListener("load", ()=> setLoaded(true));
      workDetailImage.addEventListener("error", ()=> setLoaded(false));
      workDetailImage.__hooked = true;
    }
    if(worksEmptyAction){
      worksEmptyAction.addEventListener("click", ()=>{
        showPage("stats", {scrollTop:true, smooth:true});
        setRecordsTab("consume");
      });
    }

    document.querySelectorAll("#recordsDialog .tab-nav .tab-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const tab = String(btn.dataset.tab||"");
        if(tab==="records-restock") setRecordsTab("restock");
        else if(tab==="records-stats") setRecordsTab("stats");
        else setRecordsTab("consume");
      });
    });
    if(recordsOnlyWithPattern){
      recordsOnlyWithPattern.addEventListener("change", ()=>{
        if(RECORDS_STATE.active==="consume") loadAndRenderRecordGroups();
      });
    }


    // 主题切换
    const THEME_KEY="beadsTheme";
    function applyTheme(theme){
      const body=document.body;
      body.classList.remove("theme-dark","theme-light");
      if(theme==="light"){body.classList.add("theme-light");}
      else{body.classList.add("theme-dark");theme="dark";}
      const btn=document.getElementById("btnTheme");
      if(btn){
        const isLight = theme === "light";
        btn.textContent = isLight ? "打开黑夜模式" : "关闭黑夜模式";
        btn.title = isLight ? "切换深色" : "切换浅色";
      }
      try{localStorage.setItem(THEME_KEY,theme);}catch{}
    }
    const savedTheme=(()=>{try{return localStorage.getItem(THEME_KEY)||"light";}catch{return"light";}})();
    applyTheme(savedTheme);
    document.getElementById("btnTheme").addEventListener("click",()=>{
      const isLight=document.body.classList.contains("theme-light");
      applyTheme(isLight?"dark":"light");
    });

    
    // 移动端：把“黑夜模式/主题切换”按钮放到标题同一行右侧（brand-right）
    function placeThemeButton(){
      const btn = document.getElementById("btnTheme");
      const brandRight = document.getElementById("brandRight");
      const actions = document.querySelector(".actions");
      if(!btn || !brandRight || !actions) return;
      const isMobile = window.matchMedia("(max-width: 900px)").matches;
      if(isMobile){
        if(btn.parentElement !== brandRight) brandRight.appendChild(btn);
      }else{
        if(btn.parentElement !== actions) actions.appendChild(btn);
      }
    }
    placeThemeButton();
    window.addEventListener("resize", placeThemeButton);
// ====== Mobile floating nav ======
    const navToTop = document.getElementById("navToTop");
    const navPrevSeries = document.getElementById("navPrevSeries");
    const navNextSeries = document.getElementById("navNextSeries");

    if(navToTop) navToTop.addEventListener("click", ()=>{
      window.scrollTo({top:0, behavior:"smooth"});
    });
    if(navPrevSeries) navPrevSeries.addEventListener("click", ()=>{
      const idx = getCurrentSeriesIndex();
      if(idx <= 0) window.scrollTo({top:0, behavior:"smooth"});
      else scrollToSeriesIndex(idx-1);
    });
    if(navNextSeries) navNextSeries.addEventListener("click", ()=>{
      const idx = getCurrentSeriesIndex();
      if(idx>=0) scrollToSeriesIndex(Math.min(idx+1, SERIES_ANCHORS.length-1));
    });

    let floatNavRaf = 0;
    function onScrollOrResize(){
      if(floatNavRaf) return;
      floatNavRaf = requestAnimationFrame(()=>{
        floatNavRaf = 0;
        updateFloatNavVisibility();
      });
    }
    window.addEventListener("scroll", onScrollOrResize, {passive:true});
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("resize", scheduleWorksMasonry);

    // 初始化

    
    async function bootstrap(){
      await loadMasterPalette();
      setAuthUI();
      bindSortAndViewToggles();
    initAppNavigation();
    syncHeaderHeight();
    window.addEventListener("resize", syncHeaderHeight);
    // ====== Guest tip ======
      const guestTipDialog = document.getElementById("guestTipDialog");
      const guestTipOk = document.getElementById("guestTipOk");
      const guestTipClose = document.getElementById("guestTipClose");
      function maybeShowGuestTip(){
        if(IS_LOGGED_IN) return;
        try{
          const shown = localStorage.getItem(GUEST_TIP_KEY)==="1";
          if(!shown && guestTipDialog){
            openDialog(guestTipDialog);
          }
        }catch{}
      }
      function markGuestTipShown(){
        try{ localStorage.setItem(GUEST_TIP_KEY,"1"); }catch{}
      }
      if(guestTipOk) guestTipOk.addEventListener("click", ()=>{ markGuestTipShown(); closeDialog(guestTipDialog); });
      if(guestTipClose) guestTipClose.addEventListener("click", ()=>{ markGuestTipShown(); closeDialog(guestTipDialog); });

      // ====== Auth dialogs ======
      // ====== Auth dialogs ======
const loginDialog = document.getElementById("loginDialog");
const registerDialog = document.getElementById("registerDialog");
const btnAuth = document.getElementById("btnAuth");
const btnLogout = document.getElementById("btnLogout");

if(btnAuth) btnAuth.addEventListener("click", async ()=>{
  if(!IS_LOGGED_IN){
    openDialog(loginDialog);
  }
});

if(btnLogout) btnLogout.addEventListener("click", async ()=>{
  if(btnLogout.disabled) return;
  // 服务端注销（best-effort）
  try{ await apiPost("/api/logout", {}); }catch{}
  // 本地切回 guest
  AUTH_TOKEN = "";
  IS_LOGGED_IN = false;
  USERNAME = "";
  WORK_PUBLISHED_GIDS.clear();
  try{ localStorage.removeItem(TOKEN_KEY); }catch{}
  setAuthUI();
  await initGuestDefaults();
  await loadSettings();
  await syncAll();
  await loadPatternCategories();
  maybeShowGuestTip();
  toast("已退出，数据将保存在本地浏览器","info");
});
// login dialog handlers
      const loginClose = document.getElementById("loginClose");
      const loginSubmit = document.getElementById("loginSubmit");
      const loginToRegister = document.getElementById("loginToRegister");
      if(loginClose) loginClose.addEventListener("click", ()=> closeDialog(loginDialog));
      if(loginToRegister) loginToRegister.addEventListener("click", ()=>{ closeDialog(loginDialog); openDialog(registerDialog); });

      if(loginSubmit){
        loginSubmit.addEventListener("click", async ()=>{
          const u = document.getElementById("loginUsername")?.value || "";
          const p = document.getElementById("loginPassword")?.value || "";
          if(!u || !p) return toast("请输入用户名和密码","warn");
          try{
            const r = await apiPost("/api/login", {username:u, password:p});
            if(r.ok && r.token){
              AUTH_TOKEN = r.token;
              try{ localStorage.setItem(TOKEN_KEY, AUTH_TOKEN); }catch{}
              IS_LOGGED_IN = true;
              USERNAME = r.username || u;
              WORK_PUBLISHED_GIDS.clear();
              setAuthUI();
              closeDialog(loginDialog);
              await loadSettings();
              await syncAll();
              await loadPatternCategories();
              toast("登录成功","success");
            }else{
              toast(r.message || "登录失败","error");
            }
          }catch(e){
            toast(e.message || "登录失败","error");
          }
        });
      }

      // register dialog handlers
      const registerClose = document.getElementById("registerClose");
      const registerSubmit = document.getElementById("registerSubmit");
      const registerToLogin = document.getElementById("registerToLogin");
      if(registerClose) registerClose.addEventListener("click", ()=> closeDialog(registerDialog));
      if(registerToLogin) registerToLogin.addEventListener("click", ()=>{ closeDialog(registerDialog); openDialog(loginDialog); });

      if(registerSubmit){
        registerSubmit.addEventListener("click", async ()=>{
          const u = document.getElementById("registerUsername")?.value || "";
          const p1 = document.getElementById("registerPassword")?.value || "";
          const p2 = document.getElementById("registerPassword2")?.value || "";
          if(!u || !p1 || !p2) return toast("请完整填写注册信息","warn");
          if(p1!==p2) return toast("两次密码不一致","warn");
          try{
            const r = await apiPost("/api/register", {username:u, password:p1, confirmPassword:p2});
            if(r.ok && r.token){
              AUTH_TOKEN = r.token;
              try{ localStorage.setItem(TOKEN_KEY, AUTH_TOKEN); }catch{}
              IS_LOGGED_IN = true;
              USERNAME = r.username || u;
              WORK_PUBLISHED_GIDS.clear();
              setAuthUI();
              closeDialog(registerDialog);
              await loadSettings();
              await syncAll();
              await loadPatternCategories();
              toast("注册成功","success");
            }else{
              toast(r.message || "注册失败","error");
            }
          }catch(e){
            toast(e.message || "注册失败","error");
          }
        });
      }

      // ====== Auto login / guest ======
      if(AUTH_TOKEN){
        try{
          const me = await apiGet("/api/me");
          if(me.ok){
            IS_LOGGED_IN = true;
            USERNAME = me.username || "";
          }else{
            AUTH_TOKEN = "";
            try{ localStorage.removeItem(TOKEN_KEY); }catch{}
          }
        }catch{
          AUTH_TOKEN = "";
          try{ localStorage.removeItem(TOKEN_KEY); }catch{}
        }
      }
      if(!AUTH_TOKEN){
        IS_LOGGED_IN = false;
        USERNAME = "";
        WORK_PUBLISHED_GIDS.clear();
        await initGuestDefaults();
      }else{
        IS_LOGGED_IN = true;
      }
      setAuthUI();

      // 初次渲染
      try{
        await loadSettings();
        await syncAll();
        await loadPatternCategories();
      }catch(e){
        console.error(e);
        if(!IS_LOGGED_IN){
          // guest 模式尽量继续
          toast("已进入本地模式（未登录）","info");
          await initGuestDefaults();
          await syncAll();
          await loadPatternCategories();
        }else{
          toast("无法连接云端 API，请检查服务是否运行","error");
        }
      }
      APP_READY = true;
      if(WORKS_STATE.deferLoad && document.body.dataset.page === "works"){
        WORKS_STATE.deferLoad = false;
        loadAndRenderWorks();
      }

      maybeShowGuestTip();
      warmupOssSdk();
    }

    (async function init(){
      await bootstrap();
    })();
