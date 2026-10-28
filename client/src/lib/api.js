import axios from "axios";
const origin = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");
export const api = axios.create({ baseURL: origin + "/api", withCredentials: true, headers: { "Content-Type": "application/json" } });
api.interceptors.response.use((response) => response, (error) => Promise.reject(new Error(error.response?.data?.error?.message || (error.code === "ERR_NETWORK" ? "Cannot reach the CodeVault API. Check the backend URL." : "The request could not be completed."))));
