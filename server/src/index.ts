import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { z } from "zod";
import { db } from "./db.js";

dotenv.config();

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
const JWT_SECRET: string = process.env.JWT_SECRET ?? "";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
type Role = "admin" | "manager" | "cashier";
type AuthUser = { id:number; username:string; full_name:string; role:Role };
type AuthedRequest = Request & { user?: AuthUser };
const log = (userId:number, action:string, details:string) =>
  db.prepare("INSERT INTO audit_logs(user_id,action,details) VALUES(?,?,?)").run(userId,action,details);
function auth(req:AuthedRequest,res:Response,next:NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i,"");
  if (!token) return res.status(401).json({error:"Login required"});
try {
  req.user = jwt.verify(token, JWT_SECRET) as unknown as AuthUser;
  next();
}
  catch { return res.status(401).json({error:"Session expired. Please log in again."}); }
}
function allow(...roles:Role[]) {
  return (req:AuthedRequest,res:Response,next:NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({error:"You do not have permission for this action"});
    next();
  };
}
const safeUser = (u:any) => ({id:u.id,username:u.username,full_name:u.full_name,role:u.role,active:!!u.active});
app.get("/api/health",(_req,res)=>res.json({ok:true,app:"KOOKAL POS"}));

app.post("/api/auth/login",(req,res)=>{
  const parsed=z.object({username:z.string().min(1),password:z.string().min(1)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:"Enter username and password"});
  const user=db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(parsed.data.username) as any;
  if(!user || !bcrypt.compareSync(parsed.data.password,user.password_hash)) return res.status(401).json({error:"Invalid username or password"});
  const payload={id:user.id,username:user.username,full_name:user.full_name,role:user.role};
  const token=jwt.sign(payload,JWT_SECRET,{expiresIn:"12h"});
  log(user.id,"LOGIN","Successful login");
  res.json({token,user:payload});
});
app.get("/api/auth/me",auth,(req:AuthedRequest,res)=>res.json({user:req.user}));

app.get("/api/menu",auth,(req:AuthedRequest,res)=>{
  const periods=db.prepare("SELECT * FROM meal_periods WHERE active=1 ORDER BY id").all() as any[];
  const categories=db.prepare("SELECT * FROM categories WHERE active=1 ORDER BY name").all() as any[];
  const items=db.prepare("SELECT i.*,c.name category_name,c.meal_period_id FROM items i JOIN categories c ON c.id=i.category_id WHERE i.active=1 ORDER BY i.name").all();
  res.json({periods,categories,items});
});
app.post("/api/menu/periods",auth,allow("admin"),(req:AuthedRequest,res)=>{
  const name=String(req.body.name||"").trim(); if(!name) return res.status(400).json({error:"Meal period name is required"});
  try { const info=db.prepare("INSERT INTO meal_periods(name) VALUES(?)").run(name); log(req.user!.id,"CREATE_PERIOD",name); res.status(201).json({id:info.lastInsertRowid,name}); }
  catch {res.status(409).json({error:"Meal period already exists"});}
});
app.post("/api/menu/categories",auth,allow("admin"),(req:AuthedRequest,res)=>{
  const periodId=Number(req.body.meal_period_id), name=String(req.body.name||"").trim();
  if(!periodId||!name) return res.status(400).json({error:"Meal period and category name are required"});
  try {const info=db.prepare("INSERT INTO categories(meal_period_id,name) VALUES(?,?)").run(periodId,name); log(req.user!.id,"CREATE_CATEGORY",name); res.status(201).json({id:info.lastInsertRowid});}
  catch {res.status(400).json({error:"Could not create category. Check the meal period and duplicate name."});}
});
app.post("/api/menu/items",auth,allow("admin"),(req:AuthedRequest,res)=>{
  const s=z.object({category_id:z.number().int().positive(),name:z.string().min(1),description:z.string().optional(),price:z.number().nonnegative(),gst_rate:z.number().min(0).max(100),gst_inclusive:z.boolean().optional()}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Check item name, category, price and GST rate"});
  const d=s.data;
  const info=db.prepare("INSERT INTO items(category_id,name,description,price,gst_rate,gst_inclusive) VALUES(?,?,?,?,?,?)")
    .run(d.category_id,d.name.trim(),d.description||"",d.price,d.gst_rate,d.gst_inclusive?1:0);
  log(req.user!.id,"CREATE_ITEM",d.name);
  res.status(201).json({id:info.lastInsertRowid});
});
app.patch("/api/menu/items/:id",auth,allow("admin"),(req:AuthedRequest,res)=>{
  const id=Number(req.params.id), d=req.body;
  const existing=db.prepare("SELECT * FROM items WHERE id=?").get(id) as any;
  if(!existing) return res.status(404).json({error:"Item not found"});
  const name=String(d.name??existing.name).trim(), price=Number(d.price??existing.price), gst=Number(d.gst_rate??existing.gst_rate);
  if(!name||price<0||gst<0||gst>100) return res.status(400).json({error:"Invalid item details"});
  db.prepare("UPDATE items SET category_id=?,name=?,description=?,price=?,gst_rate=?,gst_inclusive=? WHERE id=?")
    .run(Number(d.category_id??existing.category_id),name,d.description??existing.description,price,gst,(d.gst_inclusive??!!existing.gst_inclusive)?1:0,id);
  log(req.user!.id,"UPDATE_ITEM",name); res.json({ok:true});
});
app.patch("/api/menu/items/:id/availability",auth,allow("admin"),(req:AuthedRequest,res)=>{
  db.prepare("UPDATE items SET active=? WHERE id=?").run(req.body.active?1:0,Number(req.params.id)); res.json({ok:true});
});

app.get("/api/users",auth,allow("admin"),(_req,res)=>{
  res.json(db.prepare("SELECT id,username,full_name,role,active,created_at FROM users ORDER BY id DESC").all().map(safeUser));
});
app.post("/api/users",auth,allow("admin"),(req:AuthedRequest,res)=>{
  const s=z.object({username:z.string().min(3),full_name:z.string().min(2),password:z.string().min(8),role:z.enum(["admin","manager","cashier"])}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Username must be 3+ characters and password at least 8 characters"});
  try {
    const info=db.prepare("INSERT INTO users(username,full_name,password_hash,role) VALUES(?,?,?,?)")
      .run(s.data.username,s.data.full_name,bcrypt.hashSync(s.data.password,10),s.data.role);
    log(req.user!.id,"CREATE_USER",`${s.data.username} (${s.data.role})`); res.status(201).json({id:info.lastInsertRowid});
  } catch {res.status(409).json({error:"That username already exists"});}
});
app.patch("/api/users/:id/active",auth,allow("admin"),(req:AuthedRequest,res)=>{
  const id=Number(req.params.id); if(id===req.user!.id) return res.status(400).json({error:"You cannot deactivate your own account"});
  db.prepare("UPDATE users SET active=? WHERE id=?").run(req.body.active?1:0,id); log(req.user!.id,"USER_STATUS",`User ${id}: ${req.body.active?"active":"inactive"}`); res.json({ok:true});
});
app.post("/api/users/:id/password",auth,allow("admin"),(req:AuthedRequest,res)=>{
  const password=String(req.body.password||""); if(password.length<8) return res.status(400).json({error:"Password must be at least 8 characters"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(password,10),Number(req.params.id)); res.json({ok:true});
});

const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
app.post("/api/bills",auth,allow("admin","manager","cashier"),(req:AuthedRequest,res)=>{
  const s=z.object({
    customer_name:z.string().optional(),order_type:z.enum(["Dine-in","Takeaway"]),table_no:z.string().optional(),
    payment_method:z.enum(["Cash","UPI","Card","Other"]),discount:z.number().min(0).default(0),
    items:z.array(z.object({item_id:z.number().int(),quantity:z.number().positive()})).min(1)
  }).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Invalid bill details"});
  const transaction=db.transaction(()=>{
    let subtotal=0,taxTotal=0; const lines:any[]=[];
    for(const entry of s.data.items) {
      const item=db.prepare("SELECT * FROM items WHERE id=? AND active=1").get(entry.item_id) as any;
      if(!item) throw new Error("An item in this bill is no longer available. Refresh the menu.");
      const gross=money(item.price*entry.quantity);
      const tax=item.gst_inclusive ? money(gross*item.gst_rate/(100+item.gst_rate)) : money(gross*item.gst_rate/100);
      const lineTotal=item.gst_inclusive ? gross : money(gross+tax);
      subtotal+=item.gst_inclusive ? money(gross-tax) : gross; taxTotal+=tax;
      lines.push({item_id:item.id,item_name:item.name,quantity:entry.quantity,unit_price:item.price,gst_rate:item.gst_rate,gst_amount:tax,line_total:lineTotal});
    }
    subtotal=money(subtotal); taxTotal=money(taxTotal);
    const discount=money(Math.min(s.data.discount,subtotal));
    const grand=money(lines.reduce((a,b)=>a+b.line_total,0)-discount);
    const next=(db.prepare("SELECT COALESCE(MAX(id),0)+1 n FROM bills").get() as any).n;
    const billNo=`KK-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(next).padStart(4,"0")}`;
    const info=db.prepare(`INSERT INTO bills(bill_no,user_id,customer_name,order_type,table_no,subtotal,discount,tax_total,grand_total,payment_method)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(billNo,req.user!.id,s.data.customer_name||"",s.data.order_type,s.data.table_no||"",subtotal,discount,taxTotal,grand,s.data.payment_method);
    const insert=db.prepare("INSERT INTO bill_items(bill_id,item_id,item_name,quantity,unit_price,gst_rate,gst_amount,line_total) VALUES(?,?,?,?,?,?,?,?)");
    lines.forEach(l=>insert.run(info.lastInsertRowid,l.item_id,l.item_name,l.quantity,l.unit_price,l.gst_rate,l.gst_amount,l.line_total));
    log(req.user!.id,"CREATE_BILL",`${billNo} total ${grand}`);
    return {id:info.lastInsertRowid,bill_no:billNo,user_id:req.user!.id,customer_name:s.data.customer_name||"",order_type:s.data.order_type,table_no:s.data.table_no||"",subtotal,discount,tax_total:taxTotal,grand_total:grand,payment_method:s.data.payment_method,status:"PAID",created_at:new Date().toISOString(),items:lines,cashier_name:req.user!.full_name};
  });
  try {res.status(201).json(transaction());} catch(e:any) {res.status(400).json({error:e.message||"Could not save bill"});}
});
app.get("/api/bills",auth,(req:AuthedRequest,res)=>{
  const limit=Math.min(Number(req.query.limit)||100,500);
  let rows:any[];
  if(req.user!.role==="cashier") rows=db.prepare(`SELECT b.*,u.full_name cashier_name FROM bills b JOIN users u ON u.id=b.user_id WHERE b.user_id=? ORDER BY b.id DESC LIMIT ?`).all(req.user!.id,limit) as any[];
  else rows=db.prepare(`SELECT b.*,u.full_name cashier_name FROM bills b JOIN users u ON u.id=b.user_id ORDER BY b.id DESC LIMIT ?`).all(limit) as any[];
  const getItems=db.prepare("SELECT * FROM bill_items WHERE bill_id=?");
  res.json(rows.map(b=>({...b,items:getItems.all(b.id)})));
});
app.post("/api/bills/:id/cancel",auth,allow("admin","manager"),(req:AuthedRequest,res)=>{
  const reason=String(req.body.reason||"").trim(); if(reason.length<4) return res.status(400).json({error:"Please enter a cancellation reason (at least 4 characters)"});
  const bill=db.prepare("SELECT * FROM bills WHERE id=?").get(Number(req.params.id)) as any;
  if(!bill) return res.status(404).json({error:"Bill not found"});
  if(bill.status==="CANCELLED") return res.status(409).json({error:"Bill is already cancelled"});
  db.prepare("UPDATE bills SET status='CANCELLED',cancel_reason=?,cancelled_by=?,cancelled_at=CURRENT_TIMESTAMP WHERE id=?").run(reason,req.user!.id,bill.id);
  log(req.user!.id,"CANCEL_BILL",`${bill.bill_no}: ${reason}`); res.json({ok:true});
});
app.get("/api/reports/summary",auth,allow("admin","manager"),(req,res)=>{
  const from=String(req.query.from||new Date().toISOString().slice(0,10));
  const to=String(req.query.to||from);
  const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);
  if(!validDate(from)||!validDate(to)) return res.status(400).json({error:"Dates must use YYYY-MM-DD"});
  const where="date(created_at) BETWEEN ? AND ?";
  const totals=db.prepare(`SELECT COUNT(*) bill_count,COALESCE(SUM(CASE WHEN status='PAID' THEN grand_total ELSE 0 END),0) sales,COALESCE(SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END),0) cancelled,COALESCE(SUM(CASE WHEN status='PAID' THEN tax_total ELSE 0 END),0) tax FROM bills WHERE ${where}`).get(from,to) as any;
  const payments=db.prepare(`SELECT payment_method,COUNT(*) bills,SUM(grand_total) amount FROM bills WHERE ${where} AND status='PAID' GROUP BY payment_method`).all(from,to);
  const byCashier=db.prepare(`SELECT u.full_name,COUNT(*) bills,SUM(b.grand_total) amount FROM bills b JOIN users u ON u.id=b.user_id WHERE ${where} AND b.status='PAID' GROUP BY u.id ORDER BY amount DESC`).all(from,to);
  const byItem=db.prepare(`SELECT bi.item_name,SUM(bi.quantity) quantity,SUM(bi.line_total) amount FROM bill_items bi JOIN bills b ON b.id=bi.bill_id WHERE ${where} AND b.status='PAID' GROUP BY bi.item_name ORDER BY amount DESC LIMIT 20`).all(from,to);
  const daily=db.prepare(`SELECT date(created_at) day,COUNT(*) bills,SUM(CASE WHEN status='PAID' THEN grand_total ELSE 0 END) sales FROM bills WHERE ${where} GROUP BY date(created_at) ORDER BY day`).all(from,to);
  res.json({from,to,totals,average_bill:totals.bill_count-totals.cancelled>0?money(totals.sales/(totals.bill_count-totals.cancelled)):0,payments,byCashier,byItem,daily});
});
app.get("/api/audit",auth,allow("admin","manager"),(_req,res)=>res.json(db.prepare("SELECT a.*,u.full_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200").all()));

app.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{console.error(err);res.status(500).json({error:"Unexpected server error"});});
const port=Number(process.env.PORT)||4000;
app.listen(port,()=>console.log(`KOOKAL POS API running at http://localhost:${port}`));
