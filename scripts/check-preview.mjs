// Read-only Preview checks. Credentials go to curl through stdin, never argv/output.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]||'').origin;
if(!origin.includes('pickleball-cashier-')||!origin.endsWith('.vercel.app'))throw new Error('Expected immutable pickleball-cashier Preview URL');
const cache=path.resolve('.cache/npm/_npx');
const packages=fs.readdirSync(cache).map(d=>path.join(cache,d,'node_modules/vercel/package.json')).filter(p=>fs.existsSync(p));
const pkg=packages.find(p=>JSON.parse(fs.readFileSync(p,'utf8')).version==='66.1.0')||packages[0];
if(!pkg)throw new Error('Install/authenticate Vercel CLI first');
const cli=path.resolve(path.dirname(pkg),JSON.parse(fs.readFileSync(pkg,'utf8')).bin.vercel);
async function request(route,body,cookie='',customOrigin=origin){
 const config=[`header = ${JSON.stringify('Origin: '+customOrigin)}`,`header = "Content-Type: application/json"`];if(cookie)config.push(`header = ${JSON.stringify('Cookie: '+cookie)}`);if(body)config.push('request = "POST"',`data = ${JSON.stringify(JSON.stringify(body))}`);
 const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'curl',route,'--deployment',origin,'--','--silent','--show-error','--include','--write-out','\n__STATUS__%{http_code}','--config','-'],{stdio:['pipe','pipe','pipe'],windowsHide:true});const parts=[];let errors='';child.stdout.on('data',b=>parts.push(b));child.stderr.on('data',b=>errors+=String(b));child.on('error',reject);child.on('close',code=>code===0?resolve(Buffer.concat(parts)):reject(new Error('Vercel curl failed for '+route+'; CLI exit '+code)));child.stdin.end(config.join('\n')+'\n');});
 const marker=output.lastIndexOf(Buffer.from('\n__STATUS__'));assert.ok(marker>=0,'HTTP status marker');const status=Number(output.subarray(marker+11).toString().trim());let raw=output.subarray(0,marker);let headers='';while(raw.subarray(0,5).toString()==='HTTP/'){const split=raw.indexOf(Buffer.from('\r\n\r\n'));assert.ok(split>=0);headers=raw.subarray(0,split).toString();raw=raw.subarray(split+4);}return {status,headers,body:raw};
}
let count=0;const pass=name=>{count++;console.log('PASS',name);};
try{
 let r=await request('/');assert.equal(r.status,200);assert.ok(r.body.toString().includes('Court'));pass('Preview home serves application');
 r=await request('/api/workspace');assert.equal(r.status,401);pass('Unauthenticated API denied on Preview');
 r=await request('/api/auth',{email:process.env.SEED_ADMIN_EMAIL,password:process.env.SEED_ADMIN_PASSWORD},'','https://untrusted.test');assert.equal(r.status,403);pass('Preview Origin protection');
 r=await request('/api/auth',{email:process.env.SEED_ADMIN_EMAIL,password:process.env.SEED_ADMIN_PASSWORD});assert.equal(r.status,200);const match=r.headers.match(/^set-cookie:\s*(session=[^;\r\n]+)/im);assert.ok(match,'session cookie');assert.match(r.headers,/httponly/i);assert.match(r.headers,/secure/i);const cookie=match[1];pass('Atlas-backed login and secure session');
 r=await request('/api/workspace',undefined,cookie);assert.equal(r.status,200);const data=JSON.parse(r.body.toString());assert.equal(data.user.role,'Admin');for(const name of ['Revive Pro','Revive Trắng','Revive Chanh Muối']){const p=data.products.find(p=>p.name===name);assert.ok(p);assert.deepEqual(p.variants.map(v=>v.price),[15000,20000]);assert.equal(p.defaultStock,24);}assert.equal(data.products.find(p=>p.name==='Trà đá').kind,'prepared');assert.deepEqual(data.products.find(p=>p.name==='Vé Social').variants.map(v=>v.price),[30000,50000]);pass('Seeded catalog, prices and inventory configuration');
 assert.equal(data.sales.length,0);assert.equal(data.shifts.length,0);pass('Preview has no fabricated sales or shifts');
 r=await request('/api/reports?format=csv',undefined,cookie);assert.equal(r.status,200);assert.ok(r.body.toString().includes('Social'));pass('CSV export on Preview');
 r=await request('/api/reports?format=xlsx',undefined,cookie);assert.equal(r.status,200);assert.equal(r.body.subarray(0,2).toString(),'PK');pass('Excel export on Preview');
 console.log(`PREVIEW_CHECK_RESULT ${count}/${count} PASS; no sales or shifts created.`);
}catch(e){console.error('Preview verification FAIL:',e.message);process.exitCode=1;}
