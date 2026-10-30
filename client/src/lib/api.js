import axios from "axios";
const configuredOrigin=import.meta.env.VITE_API_URL;
const origin=configuredOrigin??(import.meta.env.DEV?"http://localhost:4000":"");
export const api=axios.create({baseURL:origin.replace(/\/$/,"")+"/api",withCredentials:true,headers:{"Content-Type":"application/json"},timeout:20000});
api.interceptors.response.use(r=>r,e=>Promise.reject(new Error(e.response?.data?.error?.message||(e.code==="ERR_NETWORK"?"Cannot reach CodeVault API. Check the backend deployment.":"The request could not be completed."))));
