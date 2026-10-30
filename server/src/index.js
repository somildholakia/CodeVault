import dotenv from "dotenv";
import path from "node:path";
import {fileURLToPath} from "node:url";
const serverDirectory=path.dirname(fileURLToPath(import.meta.url));
dotenv.config({path:path.resolve(serverDirectory,"../../.env")});
dotenv.config({path:path.resolve(serverDirectory,"../.env")});
import mongoose from "mongoose";
import app from "./app.js";
const port=Number(process.env.PORT||4000);
mongoose.set("bufferCommands",false);
mongoose.connection.on("connected",()=>console.info("CodeVault MongoDB connected."));
mongoose.connection.on("error",e=>console.error("MongoDB connection error:",e.message));
if(process.env.MONGODB_URI)mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000}).catch(e=>console.error("Initial MongoDB connection failed:",e.message));
else console.warn("MONGODB_URI is not configured; data routes will return 503.");
const server=app.listen(port,"0.0.0.0",()=>console.info("CodeVault API listening on port "+port+"."));
function stop(){server.close(()=>mongoose.disconnect().finally(()=>process.exit(0)));setTimeout(()=>process.exit(1),10000).unref();}
process.on("SIGTERM",stop);process.on("SIGINT",stop);
