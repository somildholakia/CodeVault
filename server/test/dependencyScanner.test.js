import test,{after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp=await fs.mkdtemp(path.join(os.tmpdir(),"codevault-dependency-tests-"));
process.env.REPO_STORAGE_PATH=path.join(temp,"repos");
const git=await import("../src/services/git.js");
const scanner=await import("../src/services/dependencyScanner.js");
let sequence=1;
const author={username:"testuser",displayName:"Dependency Tester",email:"dependency-test@codevault.local"};
async function makeRepo(){
 const id=(sequence++).toString(16).padStart(24,"0");
 await git.initRepository({_id:id,name:"dependency-fixture",description:"Dependency scan test"},{addReadme:true,authorName:author.displayName,authorEmail:author.email});
 return id;
}
after(async()=>fs.rm(temp,{recursive:true,force:true}));

test("extracts unique resolved npm packages and ignores workspace links",()=>{
 const packages=scanner.extractNpmPackages({
  lockfileVersion:3,
  packages:{
   "":{name:"fixture"},
   "node_modules/foo":{version:"1.0.0"},
   "node_modules/@scope/bar":{version:"2.0.0"},
   "node_modules/nested/node_modules/foo":{version:"1.0.0"},
   "node_modules/workspace-pkg":{version:"0.0.0",link:true},
   "node_modules/local-pkg":{version:"file:../local-pkg"}
  }
 });
 assert.equal(packages.length,2);
 assert.ok(packages.some(item=>item.name==="foo"&&item.version==="1.0.0"));
 assert.ok(packages.some(item=>item.name==="@scope/bar"&&item.version==="2.0.0"));
});

test("reports manifest dependencies without claiming a vulnerability scan without a lockfile",async()=>{
 const id=await makeRepo();
 const manifest={name:"manifest-only",dependencies:{"alpha-lib":"^1.2.0"},devDependencies:{"test-helper":"~3.0.0"}};
 await git.commitFile(id,"main","package.json",JSON.stringify(manifest,null,2),"Add manifest",author);
 const report=await scanner.scanDependencies(id,"main");
 assert.equal(report.status,"lockfile_required");
 assert.equal(report.manifestCount,1);
 assert.equal(report.packageCount,2);
 assert.ok(report.dependencies.some(item=>item.name==="alpha-lib"&&item.requested==="^1.2.0"));
 assert.deepEqual(report.findings,[]);
});

test("queries OSV using exact lockfile versions and returns severity and fixed version hints",async()=>{
 const id=await makeRepo();
 const lock={
  name:"lock-fixture",
  lockfileVersion:3,
  packages:{
   "":{name:"lock-fixture"},
   "node_modules/foo":{version:"1.0.0"},
   "node_modules/@scope/bar":{version:"2.0.0"}
  }
 };
 await git.commitFile(id,"main","package-lock.json",JSON.stringify(lock),"Add npm lockfile",author);
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith("/v1/querybatch")){
   const body=JSON.parse(options.body);
   return {ok:true,json:async()=>({results:body.queries.map(query=>query.package.name==="foo"?{vulns:[{id:"GHSA-test"}]}:{})})};
  }
  return {ok:true,json:async()=>({
   id:"GHSA-test",
   summary:"Test vulnerability in foo",
   published:"2026-01-01T00:00:00Z",
   modified:"2026-02-01T00:00:00Z",
   database_specific:{severity:"HIGH"},
   affected:[{package:{name:"foo"},ranges:[{events:[{introduced:"0"},{fixed:"1.2.3"}]}]}]
  })};
 };
 try {
  const report=await scanner.scanDependencies(id,"main");
  assert.equal(report.status,"scanned");
  assert.equal(report.packageCount,2);
  assert.equal(report.scannedPackageCount,2);
  assert.equal(report.vulnerabilityCount,1);
  assert.equal(report.findings.length,1);
  assert.equal(report.findings[0].package,"foo");
  assert.equal(report.findings[0].severity,"high");
  assert.deepEqual(report.findings[0].fixedVersions,["1.2.3"]);
  assert.equal(report.summary.high,1);
 } finally { globalThis.fetch=originalFetch; }
});
