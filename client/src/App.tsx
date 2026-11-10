import {useEffect,useMemo,useState} from "react";
import {api,money,today} from "./api";
import {LayoutDashboard,Receipt,Utensils,Users,ChartNoAxesCombined,LogOut,Plus,Printer,Trash2,Search,Leaf,Menu as MenuIcon,X,RefreshCw,ShieldCheck,Clock3} from "lucide-react";
import logoUrl from "./assets/kookal-logo.png";
type User={id:number;username:string;full_name:string;role:"admin"|"manager"|"cashier"};
type Item={id:number;category_id:number;category_name:string;meal_period_id:number;name:string;description:string;price:number;gst_rate:number;gst_inclusive:number};
type Bill={id:number;bill_no:string;customer_name:string;order_type:string;table_no:string;subtotal:number;discount:number;tax_total:number;grand_total:number;payment_method:string;status:string;created_at:string;items:any[];cashier_name:string;cancel_reason?:string};
const roleName=(r:string)=>r==="admin"?"Administrator":r==="manager"?"Manager":"Cashier";

export default function App(){
 const [user,setUser]=useState<User|null>(()=>{try{return JSON.parse(localStorage.getItem("kookal_user")||"null")}catch{return null}});
 const [token,setToken]=useState(localStorage.getItem("kookal_token"));
 const [page,setPage]=useState("pos"),[refresh,setRefresh]=useState(0),[toast,setToast]=useState("");
 const [mobileNav,setMobileNav]=useState(false);
 const notify=(s:string)=>{setToast(s);setTimeout(()=>setToast(""),3500)};
 const logout=()=>{localStorage.removeItem("kookal_token");localStorage.removeItem("kookal_user");setToken(null);setUser(null)};
 useEffect(() => {
  if (!token) return;

  let cancelled = false;

  api.get("/auth/me")
    .catch(() => {
      if (!cancelled) logout();
    });

  return () => {
    cancelled = true;
  };
}, [token]);
 if(!token||!user) return <Login onLogin={(t,u)=>{localStorage.setItem("kookal_token",t);localStorage.setItem("kookal_user",JSON.stringify(u));setToken(t);setUser(u)}}/>;
 const nav=[
  {id:"pos",label:"Billing POS",icon:Receipt,roles:["admin","manager","cashier"]},
  {id:"bills",label:"Bills",icon:Printer,roles:["admin","manager","cashier"]},
  {id:"menu",label:"Menu management",icon:Utensils,roles:["admin"]},
  {id:"users",label:"Users & access",icon:Users,roles:["admin"]},
  {id:"reports",label:"Sales reports",icon:ChartNoAxesCombined,roles:["admin","manager"]},
  {id:"audit",label:"Activity log",icon:Clock3,roles:["admin","manager"]}
 ].filter(n=>n.roles.includes(user.role));
 return <div className="app-shell">
  <aside className={`sidebar ${mobileNav?"show":""}`}>
   <div className="brand"><img src={logoUrl} alt="KOOKAL logo" /><div><b>KOOKAL</b><span>FARM & KITCHEN</span></div><button className="mobile-close" onClick={()=>setMobileNav(false)}><X/></button></div>
   <div className="side-label">WORKSPACE</div>
   {nav.map(n=><button key={n.id} className={`nav-link ${page===n.id?"active":""}`} onClick={()=>{setPage(n.id);setMobileNav(false)}}><n.icon size={18}/>{n.label}</button>)}
   <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{user.full_name.slice(0,1).toUpperCase()}</div><div className="user-meta"><b>{user.full_name}</b><span>{roleName(user.role)}</span></div></div><button className="nav-link logout" onClick={logout}><LogOut size={18}/>Sign out</button></div>
  </aside>
  {mobileNav&&<div className="scrim" onClick={()=>setMobileNav(false)}/>}
  <main className="main-area">
   <header className="topbar"><button className="mobile-menu" onClick={()=>setMobileNav(true)}><MenuIcon/></button><div><span className="eyebrow">KOOKAL / FARM & KITCHEN</span><h1>{nav.find(n=>n.id===page)?.label||"Dashboard"}</h1></div><div className="top-user"><span className="status-dot"/><span>Local POS</span><b>{user.full_name}</b></div></header>
   <div className="page-content">
    {page==="pos"&&<POS user={user} notify={notify} onCreated={()=>setRefresh(x=>x+1)}/>}
    {page==="bills"&&<Bills user={user} refresh={refresh} notify={notify}/>}
    {page==="menu"&&<MenuAdmin notify={notify}/>}
    {page==="users"&&<UsersAdmin notify={notify}/>}
    {page==="reports"&&<Reports/>}
    {page==="audit"&&<Audit/>}
   </div>
  </main>
  {toast&&<div className="toast">{toast}</div>}
 </div>
}


function Login({ onLogin }: { onLogin: (t: string, u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await api.post("/auth/login", {
        username: username.trim(),
        password,
      });

      const { token, user } = response.data || {};

      if (!token || !user) {
        throw new Error("Invalid login response from server.");
      }

      onLogin(token, user);
    } catch (e: any) {
      setError(
        e.response?.data?.error ||
        e.message ||
        "Unable to connect to KOOKAL server."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src={logoUrl} alt="KOOKAL logo" />
          <div className="eyebrow">FARM &amp; KITCHEN</div>
        </div>

        <div className="login-heading">
          <span className="eyebrow">WELCOME BACK</span>
          <h1>
            Good food begins
            <br />
            with good hospitality.
          </h1>
          <p>Sign in to manage your KOOKAL operations.</p>
        </div>

        <form onSubmit={submit}>
          <label>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />

          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error && <div className="error">{error}</div>}

          <button
            className="btn primary full"
            type="submit"
            disabled={busy}
          >
            {busy ? "Signing in..." : "Sign in to KOOKAL"}
          </button>
        </form>

        <div className="login-foot">
          <ShieldCheck size={15} />
          Secure role-based access
        </div>
      </div>

      <div className="login-art">
        <div className="art-copy">
          <span>FROM FARM TO TABLE</span>
          <h2>
            Rooted in nature.
            <br />
            Made for gathering.
          </h2>
          <p>Good food, warm moments, and a place to belong.</p>
        </div>
      </div>
    </div>
  );
}


function POS({user,notify,onCreated}:{user:User;notify:(s:string)=>void;onCreated:()=>void}){
 const [menu,setMenu]=useState<any>({periods:[],categories:[],items:[]}),[period,setPeriod]=useState<number|null>(null),[category,setCategory]=useState<number|null>(null);
 const [cart,setCart]=useState<{item:Item;qty:number}[]>([]),[search,setSearch]=useState(""),[orderType,setOrderType]=useState("Dine-in"),[table,setTable]=useState(""),[customer,setCustomer]=useState(""),[discount,setDiscount]=useState("0"),[payment,setPayment]=useState("Cash"),[busy,setBusy]=useState(false);
 useEffect(()=>{api.get("/menu").then(r=>{setMenu(r.data);if(!period&&r.data.periods[0])setPeriod(r.data.periods[0].id)}).catch(()=>notify("Could not load menu"))},[]);
 const categories=menu.categories.filter((c:any)=>c.meal_period_id===period);
 const items:Item[]=menu.items.filter((i:Item)=>(!category||i.category_id===category)&&(!period||i.meal_period_id===period)&&i.name.toLowerCase().includes(search.toLowerCase()));
 const add=(item:Item)=>setCart(old=>{const f=old.find(x=>x.item.id===item.id);return f?old.map(x=>x.item.id===item.id?{...x,qty:x.qty+1}:x):[...old,{item,qty:1}]});
 const change=(id:number,qty:number)=>setCart(old=>qty<=0?old.filter(x=>x.item.id!==id):old.map(x=>x.item.id===id?{...x,qty}:x));
 const subtotal=cart.reduce((s,x)=>{const gross=x.item.price*x.qty;return s+(x.item.gst_inclusive?gross-gross*x.item.gst_rate/(100+x.item.gst_rate):gross)},0);
 const tax=cart.reduce((s,x)=>s+(x.item.gst_inclusive?x.item.price*x.qty*x.item.gst_rate/(100+x.item.gst_rate):x.item.price*x.qty*x.item.gst_rate/100),0);
 const total=cart.reduce((s,x)=>s+x.item.price*x.qty*(x.item.gst_inclusive?1:1+x.item.gst_rate/100),0)-Math.min(Number(discount)||0,subtotal);
 async function pay(){if(!cart.length)return notify("Add at least one item");const printWindow=window.open("about:blank","_blank","width=420,height=700");setBusy(true);try{const r=await api.post("/bills",{customer_name:customer,order_type:orderType,table_no:table,payment_method:payment,discount:Number(discount)||0,items:cart.map(x=>({item_id:x.item.id,quantity:x.qty}))});setCart([]);setDiscount("0");notify(`Bill ${r.data.bill_no} saved. Opening receipt…`);onCreated();if(printWindow)printReceipt(r.data,printWindow);else notify("Bill saved. Allow pop-ups and reprint it from Bills."); }catch(e:any){printWindow?.close();notify(e.response?.data?.error||"Could not save bill")}finally{setBusy(false)}}
 return <div className="pos-layout"><section className="menu-panel"><div className="section-heading"><div><span className="eyebrow">ORDER BUILDER</span><h2>What are we serving?</h2></div><div className="search-box"><Search size={16}/><input placeholder="Find an item…" value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="period-tabs">{menu.periods.map((p:any)=><button key={p.id} className={period===p.id?"selected":""} onClick={()=>{setPeriod(p.id);setCategory(null)}}>{p.name}</button>)}</div><div className="category-tabs"><button className={!category?"selected":""} onClick={()=>setCategory(null)}>All items</button>{categories.map((c:any)=><button key={c.id} className={category===c.id?"selected":""} onClick={()=>setCategory(c.id)}>{c.name}</button>)}</div><div className="item-grid">{items.map(item=><button className="item-card" key={item.id} onClick={()=>add(item)}><span className="item-plus"><Plus size={16}/></span><b>{item.name}</b><span>{item.description||item.category_name}</span><strong>{money(item.price)}</strong><small>{item.gst_rate}% GST {item.gst_inclusive?"inclusive":"extra"}</small></button>)}{!items.length&&<div className="empty">No menu items yet. Ask an Admin to add items.</div>}</div></section>
 <aside className="cart-panel"><div className="cart-head"><div><span className="eyebrow">CURRENT ORDER</span><h2>New bill</h2></div><span className="cart-count">{cart.reduce((s,x)=>s+x.qty,0)} items</span></div><div className="order-fields"><select value={orderType} onChange={e=>setOrderType(e.target.value)}><option>Dine-in</option><option>Takeaway</option></select>{orderType==="Dine-in"&&<input placeholder="Table number (optional)" value={table} onChange={e=>setTable(e.target.value)}/>}<input placeholder="Customer name (optional)" value={customer} onChange={e=>setCustomer(e.target.value)}/></div><div className="cart-items">{cart.map(x=><div className="cart-row" key={x.item.id}><div className="cart-item-name"><b>{x.item.name}</b><span>{money(x.item.price)} each</span></div><div className="qty-control"><button onClick={()=>change(x.item.id,x.qty-1)}>−</button><b>{x.qty}</b><button onClick={()=>change(x.item.id,x.qty+1)}>+</button></div><strong>{money(x.item.price*x.qty)}</strong></div>)}{!cart.length&&<div className="cart-empty"><Receipt size={30}/><b>Your order is empty</b><span>Select items to start a bill</span></div>}</div><div className="bill-summary"><div className="summary-line"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="summary-line"><span>GST (included + extra)</span><b>{money(tax)}</b></div><div className="discount-row"><label>Discount (₹)</label><input type="number" min="0" max={subtotal} value={discount} onChange={e=>setDiscount(e.target.value)}/></div><div className="total-line"><span>Grand total</span><strong>{money(total)}</strong></div><label className="field-label">Payment method</label><div className="payment-tabs">{["Cash","UPI","Card","Other"].map(p=><button className={payment===p?"selected":""} onClick={()=>setPayment(p)} key={p}>{p}</button>)}</div><button className="btn primary full pay-btn" onClick={pay} disabled={!cart.length||busy}><Printer size={17}/>{busy?"Saving bill…":`Pay & Print · ${money(total)}`}</button><button className="text-btn full" onClick={()=>{if(confirm("Clear this order?"))setCart([])}}>Clear order</button></div></aside></div>
}

function printReceipt(b:Bill,targetWindow?:Window|null){
 const w=targetWindow||window.open("","_blank","width=420,height=700"); if(!w){alert("Please allow pop-ups to print the receipt.");return;}
 const rows=b.items.map(i=>`<tr><td>${escapeHtml(i.item_name)}<small>${i.quantity} × ${money(i.unit_price)}</small></td><td>${money(i.line_total)}</td></tr>`).join("");
 w.document.write(`<!doctype html><html><head><title>${b.bill_no}</title><style>@page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{width:74mm;margin:0 auto;font:12px Arial,sans-serif;color:#111}header{text-align:center;padding:8px 0}header img{width:40mm;max-height:25mm;object-fit:contain}h2{font-size:16px;margin:5px}p{margin:3px 0}.rule{border-top:1px dashed #333;margin:8px 0}table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}small{display:block;font-size:10px}.totals p{display:flex;justify-content:space-between}.grand{font-size:16px;font-weight:bold}.center{text-align:center}.muted{font-size:10px}</style></head><body><header><img src={logoUrl} alt="KOOKAL logo" /><h2>KOOKAL – FARM & KITCHEN</h2><p>Food made with warmth</p></header><div class="rule"></div><p><b>Bill:</b> ${b.bill_no}</p><p><b>Date:</b> ${new Date(b.created_at).toLocaleString("en-IN")}</p><p><b>Cashier:</b> ${escapeHtml(b.cashier_name||"")}</p><p><b>Type:</b> ${b.order_type} ${b.table_no?`· Table ${escapeHtml(b.table_no)}`:""}</p>${b.customer_name?`<p><b>Customer:</b> ${escapeHtml(b.customer_name)}</p>`:""}<div class="rule"></div><table>${rows}</table><div class="rule"></div><div class="totals"><p><span>Subtotal</span><b>${money(b.subtotal)}</b></p><p><span>GST</span><b>${money(b.tax_total)}</b></p><p><span>Discount</span><b>${money(b.discount)}</b></p><p class="grand"><span>TOTAL</span><span>${money(b.grand_total)}</span></p><p><span>Payment</span><b>${b.payment_method}</b></p></div><div class="rule"></div><p class="center"><b>Thank you for visiting KOOKAL!</b></p><p class="center muted">We look forward to serving you again.</p><script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}</script></body></html>`);
 w.document.close();
}
function escapeHtml(s:string){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!))}

function Bills({user,refresh,notify}:{user:User;refresh:number;notify:(s:string)=>void}){
 const [bills,setBills]=useState<Bill[]>([]),[reason,setReason]=useState(""),[cancelId,setCancelId]=useState<number|null>(null),[filter,setFilter]=useState("ALL");
 const load=()=>api.get("/bills").then(r=>setBills(r.data)).catch(()=>notify("Could not load bills"));
 useEffect(()=>{load()},[refresh]);
 const filtered=bills.filter(b=>filter==="ALL"||b.status===filter);
 async function cancel(){if(!cancelId)return;try{await api.post(`/bills/${cancelId}/cancel`,{reason});setCancelId(null);setReason("");notify("Bill cancelled and retained in records");load()}catch(e:any){notify(e.response?.data?.error||"Cancellation failed")}}
 return <div className="card"><div className="section-heading"><div><span className="eyebrow">TRANSACTION HISTORY</span><h2>Recent bills</h2></div><div className="inline-actions"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">All bills</option><option value="PAID">Paid</option><option value="CANCELLED">Cancelled</option></select><button className="btn secondary" onClick={load}><RefreshCw size={15}/> Refresh</button></div></div><div className="table-wrap"><table><thead><tr><th>Bill no.</th><th>Date & time</th><th>Cashier</th><th>Payment</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filtered.map(b=><tr key={b.id}><td><b>{b.bill_no}</b></td><td>{new Date(b.created_at).toLocaleString("en-IN")}</td><td>{b.cashier_name}</td><td>{b.payment_method}</td><td><b>{money(b.grand_total)}</b></td><td><span className={`pill ${b.status==="PAID"?"green":"red"}`}>{b.status}</span></td><td><div className="inline-actions"><button className="icon-btn" title="Reprint" onClick={()=>printReceipt(b)}><Printer size={16}/></button>{user.role!=="cashier"&&b.status==="PAID"&&<button className="icon-btn danger-icon" title="Cancel bill" onClick={()=>{setCancelId(b.id);setReason("")}}><Trash2 size={16}/></button>}</div></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty">No bills found.</div>}</div>{cancelId&&<div className="modal-backdrop"><div className="modal"><h2>Cancel bill?</h2><p>This action will mark the bill as cancelled. The original record will be retained for audit.</p><label>Reason for cancellation</label><textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Enter a clear reason…" rows={3}/><div className="modal-actions"><button className="btn secondary" onClick={()=>setCancelId(null)}>Go back</button><button className="btn danger" onClick={cancel}>Confirm cancellation</button></div></div></div>}</div>
}

function MenuAdmin({notify}:{notify:(s:string)=>void}){
 const [menu,setMenu]=useState<any>({periods:[],categories:[],items:[]}),[periodName,setPeriodName]=useState(""),[catName,setCatName]=useState(""),[periodId,setPeriodId]=useState(""),[item,setItem]=useState({category_id:"",name:"",description:"",price:"",gst_rate:"5",gst_inclusive:false});
 const load=()=>api.get("/menu").then(r=>{setMenu(r.data);if(!periodId&&r.data.periods[0])setPeriodId(String(r.data.periods[0].id))});
 useEffect(()=>{load()},[]);
 async function addPeriod(e:any){e.preventDefault();try{await api.post("/menu/periods",{name:periodName});setPeriodName("");notify("Meal period created");load()}catch(e:any){notify(e.response?.data?.error||"Could not add meal period")}}
 async function addCat(e:any){e.preventDefault();try{await api.post("/menu/categories",{meal_period_id:Number(periodId),name:catName});setCatName("");notify("Category created");load()}catch(e:any){notify(e.response?.data?.error||"Could not add category")}}
 async function addItem(e:any){e.preventDefault();try{await api.post("/menu/items",{...item,category_id:Number(item.category_id),price:Number(item.price),gst_rate:Number(item.gst_rate)});setItem({...item,name:"",description:"",price:""});notify("Menu item created");load()}catch(e:any){notify(e.response?.data?.error||"Could not add item")}}
 async function toggle(i:Item){try{await api.patch(`/menu/items/${i.id}/availability`,{active:!Boolean((i as any).active)});notify("Item availability updated");load()}catch{notify("Update failed")}}
 return <div className="admin-grid"><div className="card"><span className="eyebrow">MENU STRUCTURE</span><h2>Meal periods</h2><form className="stack-form" onSubmit={addPeriod}><label>New meal period</label><div className="input-action"><input placeholder="e.g. Weekend Brunch" value={periodName} onChange={e=>setPeriodName(e.target.value)} required/><button className="btn primary"><Plus size={16}/> Add</button></div></form><div className="period-list">{menu.periods.map((p:any)=><div className="period-row" key={p.id}><b>{p.name}</b><span>{menu.categories.filter((c:any)=>c.meal_period_id===p.id).length} categories</span></div>)}</div><hr/><h2>Categories</h2><form className="stack-form" onSubmit={addCat}><label>Meal period</label><select value={periodId} onChange={e=>setPeriodId(e.target.value)}>{menu.periods.map((p:any)=><option value={p.id} key={p.id}>{p.name}</option>)}</select><label>Category name</label><div className="input-action"><input placeholder="e.g. Main Course" value={catName} onChange={e=>setCatName(e.target.value)} required/><button className="btn primary"><Plus size={16}/> Add</button></div></form><div className="category-list">{menu.categories.filter((c:any)=>String(c.meal_period_id)===periodId).map((c:any)=><span key={c.id} className="tag">{c.name}</span>)}</div></div>
 <div className="card"><span className="eyebrow">FOOD & BEVERAGE CATALOGUE</span><h2>Add menu item</h2><form className="stack-form" onSubmit={addItem}><label>Category</label><select value={item.category_id} onChange={e=>setItem({...item,category_id:e.target.value})} required><option value="">Choose category</option>{menu.categories.map((c:any)=><option key={c.id} value={c.id}>{menu.periods.find((p:any)=>p.id===c.meal_period_id)?.name} · {c.name}</option>)}</select><label>Item name</label><input placeholder="e.g. Farmhouse Pizza" value={item.name} onChange={e=>setItem({...item,name:e.target.value})} required/><label>Description (optional)</label><input placeholder="Short menu description" value={item.description} onChange={e=>setItem({...item,description:e.target.value})}/><div className="form-two"><div><label>Price (₹)</label><input type="number" min="0" step="0.01" value={item.price} onChange={e=>setItem({...item,price:e.target.value})} required/></div><div><label>GST rate (%)</label><select value={item.gst_rate} onChange={e=>setItem({...item,gst_rate:e.target.value})}>{["0","5","12","18","28"].map(v=><option key={v}>{v}</option>)}</select></div></div><label className="check-label"><input type="checkbox" checked={item.gst_inclusive} onChange={e=>setItem({...item,gst_inclusive:e.target.checked})}/> Price already includes GST</label><button className="btn primary"><Plus size={16}/> Save menu item</button></form><hr/><h2>Current menu items</h2><div className="table-wrap compact"><table><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>GST</th></tr></thead><tbody>{menu.items.map((i:Item)=><tr key={i.id}><td><b>{i.name}</b></td><td>{i.category_name}</td><td>{money(i.price)}</td><td>{i.gst_rate}% {i.gst_inclusive?"incl.":"extra"}</td></tr>)}</tbody></table>{!menu.items.length&&<div className="empty">Add your first menu item above.</div>}</div></div></div>
}


function UsersAdmin({ notify }: { notify: (s: string) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({
    full_name: "",
    username: "",
    password: "",
    role: "cashier",
  });

  const load = async () => {
    try {
      const response = await api.get("/users");
      setUsers(Array.isArray(response.data?.users) ? response.data.users : []);
    } catch (error: any) {
      notify(error.response?.data?.error || "Could not load users");
    }
  };

  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    try {
      await api.post("/users", form);

      setForm({
        full_name: "",
        username: "",
        password: "",
        role: "cashier",
      });

      notify("User account created");
      await load();
    } catch (error: any) {
      notify(error.response?.data?.error || "Could not create account");
    }
  }

  async function toggle(u: any) {
    try {
      await api.patch(`/users/${u.id}/active`, {
        active: !u.active,
      });

      notify("Account status updated");
      await load();
    } catch (error: any) {
      notify(error.response?.data?.error || "Update failed");
    }
  }

  return (
    <div className="admin-grid">
      <div className="card">
        <span className="eyebrow">TEAM ACCESS</span>
        <h2>Create staff account</h2>

        <form className="stack-form" onSubmit={add}>
          <label>Full name</label>
          <input
            value={form.full_name}
            onChange={(e) =>
              setForm({ ...form, full_name: e.target.value })
            }
            required
          />

          <label>Username</label>
          <input
            value={form.username}
            onChange={(e) =>
              setForm({ ...form, username: e.target.value })
            }
            minLength={3}
            required
          />

          <label>Temporary password</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) =>
              setForm({ ...form, password: e.target.value })
            }
            minLength={8}
            required
          />

          <label>Role</label>
          <select
            value={form.role}
            onChange={(e) =>
              setForm({ ...form, role: e.target.value })
            }
          >
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="admin">Administrator</option>
          </select>

          <button className="btn primary" type="submit">
            <Plus size={16} /> Create account
          </button>
        </form>

        <p className="hint">
          Passwords must be at least 8 characters. Share credentials
          privately and ask staff to keep them secure.
        </p>
      </div>

      <div className="card">
        <span className="eyebrow">ACTIVE ACCOUNTS</span>
        <h2>Users &amp; permissions</h2>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.full_name || "—"}</b></td>
                  <td>{u.username}</td>
                  <td>{roleName(u.role)}</td>
                  <td>
                    <span className={`pill ${u.active ? "green" : "red"}`}>
                      {u.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    {u.role !== "admin" && (
                      <button
                        className="btn tiny secondary"
                        type="button"
                        onClick={() => toggle(u)}
                      >
                        {u.active ? "Deactivate" : "Activate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {users.length === 0 && (
                <tr>
                  <td colSpan={5}>No user accounts found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}



function Reports() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!from || !to) {
      setError("Please select both dates.");
      return;
    }

    if (from > to) {
      setError("From date cannot be later than To date.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await api.get("/reports/summary", {
        params: { from, to },
      });

      setData(response.data);
    } catch (e: any) {
      setError(
        e.response?.data?.error || "Unable to load report"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="report-page">
      <div className="card report-filter">
        <div>
          <span className="eyebrow">BUSINESS INTELLIGENCE</span>
          <h2>Sales performance</h2>
        </div>

        <div className="date-filters">
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>

          <label>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>

          <button
            className="btn primary"
            type="button"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Loading..." : "Apply"}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {loading && <div className="card">Loading report...</div>}

      {!loading && data && (
        <>
          <div className="stats-grid">
            <Stat label="Net sales" value={money(data.totals?.sales)} />
            <Stat label="Total bills" value={data.totals?.bill_count ?? 0} />
            <Stat label="Average paid bill" value={money(data.average_bill)} />
            <Stat label="Cancelled bills" value={data.totals?.cancelled ?? 0} />
            <Stat label="GST collected" value={money(data.totals?.tax)} />
          </div>

          <div className="admin-grid">
            <div className="card">
              <h2>Payment breakdown</h2>
              <DataTable
                heads={["Method", "Bills", "Amount"]}
                rows={(data.payments || []).map((x: any) => [
                  x.payment_method,
                  x.bills,
                  money(x.amount),
                ])}
              />
            </div>

            <div className="card">
              <h2>Cashier performance</h2>
              <DataTable
                heads={["Cashier", "Bills", "Sales"]}
                rows={(data.byCashier || []).map((x: any) => [
                  x.full_name,
                  x.bills,
                  money(x.amount),
                ])}
              />
            </div>

            <div className="card">
              <h2>Top selling items</h2>
              <DataTable
                heads={["Item", "Qty", "Sales"]}
                rows={(data.byItem || []).map((x: any) => [
                  x.item_name,
                  x.quantity,
                  money(x.amount),
                ])}
              />
            </div>

            <div className="card">
              <h2>Daily sales</h2>
              <DataTable
                heads={["Date", "Bills", "Sales"]}
                rows={(data.daily || []).map((x: any) => [
                  x.day,
                  x.bills,
                  money(x.sales),
                ])}
              />
            </div>
          </div>

          <button
            className="btn secondary"
            type="button"
            onClick={() => exportCsv(data)}
          >
            Export report CSV
          </button>
        </>
      )}
    </div>
  );
}

function Stat({label,value}:{label:string;value:any}){return <div className="stat-card"><span>{label}</span><b>{value}</b></div>}
function DataTable({heads,rows}:{heads:string[];rows:any[][]}){return <div className="table-wrap"><table><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table>{!rows.length&&<div className="empty">No data for this period.</div>}</div>}
function exportCsv(d: any) {
  const rows = [
    ["KOOKAL Sales Report", `${d.from} to ${d.to}`],
    [],
    ["Metric", "Value"],
    ["Sales", d.totals.sales],
    ["Bill count", d.totals.bill_count],
    ["Cancelled", d.totals.cancelled],
    ["GST", d.totals.tax],
    [],
    ["Payment", "Bills", "Amount"],
    ...d.payments.map((x: any) => [x.payment_method, x.bills, x.amount]),
    [],
    ["Cashier", "Bills", "Sales"],
    ...d.byCashier.map((x: any) => [x.full_name, x.bills, x.amount]),
    [],
    ["Item", "Quantity", "Sales"],
    ...d.byItem.map((x: any) => [x.item_name, x.quantity, x.amount])
  ];

  const csv = rows
    .map((r: any[]) =>
      r.map((v: unknown) =>
        `"${String(v ?? "").replace(/"/g, '""')}"`
      ).join(",")
    )
    .join("\n");

  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv" })
  );
  a.download = `kookal-sales-${d.from}-${d.to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const response = await api.get("/audit");
      setRows(Array.isArray(response.data?.logs) ? response.data.logs : []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Could not load activity logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card">
      <span className="eyebrow">ACCOUNTABILITY</span>
      <h2>Recent activity</h2>

      {loading && <p className="hint">Loading activity...</p>}

      {!loading && error && (
        <div className="hint">
          <p>{error}</p>
          <button className="btn secondary" type="button" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date &amp; time</th>
                <th>User</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.created_at
                      ? new Date(
                          /Z$|[+-]\d{2}:\d{2}$/.test(r.created_at)
                            ? r.created_at
                            : `${r.created_at}Z`
                        ).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })
                      : "—"}
                  </td>
                  <td>{r.full_name || "System"}</td>
                  <td>
                    <span className="pill">{r.action || "—"}</span>
                  </td>
                  <td>{r.details || "—"}</td>
                </tr>
              ))}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={4}>No activity recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
