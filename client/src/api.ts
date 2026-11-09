import axios from "axios";
export const api=axios.create({baseURL:"/api"});
api.interceptors.request.use(config=>{
  const token=localStorage.getItem("kookal_token");
  if(token) config.headers.Authorization=`Bearer ${token}`;
  return config;
});
api.interceptors.response.use(r=>r,e=>{
  if(e.response?.status===401){localStorage.removeItem("kookal_token");localStorage.removeItem("kookal_user");}
  return Promise.reject(e);
});
export const money=(v:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(v||0));
export const today=()=>new Date().toISOString().slice(0,10);
