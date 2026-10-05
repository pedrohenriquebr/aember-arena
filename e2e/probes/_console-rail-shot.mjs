import { spawn } from "node:child_process";
import { join } from "node:path";
const ROOT=process.cwd(), PORT=5211, url=`http://127.0.0.1:${PORT}/`;
const child=spawn(process.execPath,[join(ROOT,"node_modules","vite","bin","vite.js"),"--host","127.0.0.1","--port",String(PORT),"--strictPort"],{cwd:ROOT,stdio:"ignore"});
try{
for(let i=0;i<200;i++){try{if((await fetch(url)).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
const {chromium}=await import("playwright-core");
const b=await chromium.launch({channel:"msedge",headless:true});
for(const view of ["2d","3d"]){
const page=await b.newPage({viewport:{width:1280,height:800}});
await page.goto(url);
await page.evaluate((v)=>{localStorage.setItem("aember-arena-language","en");localStorage.setItem("aember-arena-tutorial-seen","1");localStorage.setItem("aember-arena-settings",JSON.stringify({language:"en",sfx:false,music:false,animations:false,tableView:v}))},view);
await page.reload();await page.waitForSelector(".home-screen");
await page.locator(".header-nav .nav-link").nth(2).click();
await page.locator(".config-screen .config-step-pill").last().click();
await page.locator(".config-screen .cta-button").click();
await page.waitForSelector(".game-screen");
const keep=page.locator(".mulligan-keep");if(await keep.count())await keep.click();
await page.waitForTimeout(1200);
await page.screenshot({path:`e2e/shots/console-rail-${view}.png`});
console.log(view, await page.evaluate(()=>{const c=document.querySelector(".turn-console").getBoundingClientRect(),r=document.querySelector(".command-rail").getBoundingClientRect(),n=document.querySelector(".rail-topline").getBoundingClientRect();return {console:[c.top,c.bottom],rail:r.left,notesTop:n.top}}));
}
await b.close();}finally{spawn("taskkill",["/pid",String(child.pid),"/T","/F"],{stdio:"ignore"})}
