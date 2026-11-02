import {useEffect,useState} from "react";
import {BrowserRouter,Link,NavLink,Route,Routes,useNavigate,useParams} from "react-router-dom";
import {Activity,ArrowRight,ChevronRight,CircleDot,FolderGit2,GitBranch,GitCommitHorizontal,GitMerge,LayoutDashboard,LogOut,Plus,Search,ShieldCheck,Users,FileCode2,Code2,X,AlertCircle,LockKeyhole,Globe2,MessageSquare,UserPlus,Clock3,Check,RefreshCw,ChevronDown,GitPullRequest,Tag,GitFork,ArrowLeftRight,History} from "lucide-react";
import {api} from "./lib/api.js";
const date=v=>v?new Date(v).toLocaleDateString():"—";
const sha=v=>v?String(v).slice(0,7):"—";

function arrangeCommitGraph(commits){
 const indexBySha=new Map(commits.map((commit,index)=>[commit.sha,index]));
 const laneHeads=[],nodes=[],edges=[];
 for(let index=0;index<commits.length;index++){
  const commit=commits[index];
  let lane=laneHeads.indexOf(commit.sha);
  if(lane<0){lane=laneHeads.indexOf(null);if(lane<0)lane=laneHeads.length;laneHeads[lane]=commit.sha;}
  laneHeads[lane]=null;
  nodes.push({sha:commit.sha,lane,index});
  for(let parentIndex=0;parentIndex<commit.parents.length;parentIndex++){
   const parent=commit.parents[parentIndex],futureIndex=indexBySha.get(parent);
   if(futureIndex===undefined||futureIndex<=index)continue;
   let parentLane=laneHeads.indexOf(parent);
   if(parentLane<0){
    parentLane=parentIndex===0?lane:laneHeads.indexOf(null);
    if(parentLane<0)parentLane=laneHeads.length;
    laneHeads[parentLane]=parent;
   }
   edges.push({from:lane,to:parentLane,start:index,end:futureIndex,merge:parentIndex>0});
  }
 }
 const laneCount=Math.max(1,laneHeads.length,...nodes.map(node=>node.lane+1));
 return {nodes,edges,laneCount,width:laneCount*24+20,height:Math.max(1,commits.length)*56};
}


function parseReviewDiff(diff){
 const rows=[];
 let path="",newLine=0,insideHunk=false;
 for(const raw of String(diff||"").split(String.fromCharCode(10))){
  if(raw.startsWith("+++ b/")){path=raw.slice(6);insideHunk=false;rows.push({type:"meta",text:raw,path});continue;}
  if(raw.startsWith("diff --git ")){insideHunk=false;rows.push({type:"meta",text:raw,path:""});continue;}
  if(raw.startsWith("@@ ")){
   const hunk=raw.match(/\+([0-9]+)(?:,([0-9]+))? @@/);
   newLine=hunk?Number(hunk[1]):0;insideHunk=Boolean(hunk);
   rows.push({type:"meta",text:raw,path});continue;
  }
  if(!insideHunk){rows.push({type:"meta",text:raw,path});continue;}
  if(raw.startsWith("+")&&!raw.startsWith("+++")){rows.push({type:"added",text:raw.slice(1),path,line:newLine});newLine++;}
  else if(raw.startsWith("-")&&!raw.startsWith("---"))rows.push({type:"removed",text:raw.slice(1),path});
  else if(raw.startsWith(" ")){rows.push({type:"context",text:raw.slice(1),path,line:newLine});newLine++;}
  else rows.push({type:"meta",text:raw,path});
 }
 return rows;
}

function Mark(){return <span className="mark"><GitBranch size={18}/></span>}
function Spin(){return <span className="spinner"/>}
function Btn({children,...props}){return <button className="btn dark" {...props}>{children}</button>}
function Empty({title,body,action,onAction}){return <div className="empty"><FolderGit2 size={24}/><h3>{title}</h3><p>{body}</p>{action&&<button className="btn lime" onClick={onAction}>{action}<ArrowRight size={14}/></button>}</div>}
function Auth({done}){const [register,setRegister]=useState(false),[form,setForm]=useState({username:"",displayName:"",email:"",password:""}),[error,setError]=useState(""),[busy,setBusy]=useState(false),nav=useNavigate();const update=e=>setForm({...form,[e.target.name]:e.target.value});const submit=async e=>{e.preventDefault();setBusy(true);try{const r=await api.post(register?"/auth/register":"/auth/login",form);done(r.data.user);nav("/");}catch(x){setError(x.message);}finally{setBusy(false);}};return <div className="auth"><aside className="auth-art"><div className="brand"><Mark/><b>codevault<span>.</span></b></div><div className="auth-hero"><small>VERSION CONTROL, WITH CLARITY</small><h1>Good code.<br/>Clear history.<br/><em>Better together.</em></h1><p>Keep your source, decisions, and progress connected.</p><div className="art-graph"><i/><i/><i/></div></div><footer>A BETTER PLACE TO BUILD <span>01 — 04</span></footer></aside><section className="auth-side"><div className="mobile-brand"><Mark/><b>codevault<span>.</span></b></div><form className="auth-form form" onSubmit={submit}><small>YOUR WORKSPACE STARTS HERE</small><h2>{register?"Make room to build.":"Welcome back."}</h2><p>{register?"Create an account and start your first repository.":"Sign in to pick up where your team left off."}</p><div className="switch"><button type="button" className={!register?"picked":""} onClick={()=>setRegister(false)}>Sign in</button><button type="button" className={register?"picked":""} onClick={()=>setRegister(true)}>Create account</button></div>{register&&<><label>Display name<input name="displayName" value={form.displayName} onChange={update} maxLength="80" required/></label><label>Username<input name="username" value={form.username} onChange={update} pattern="[A-Za-z0-9_-]{3,30}" required/></label></>}<label>Email address<input type="email" name="email" value={form.email} onChange={update} required/></label><label>Password<input type="password" name="password" value={form.password} onChange={update} minLength="10" maxLength="128" required/></label>{error&&<div className="error"><AlertCircle size={15}/>{error}</div>}<button className="btn dark full" disabled={busy}>{busy&&<Spin/>}{register?"Create account":"Sign in to CodeVault"}<ArrowRight size={15}/></button><div className="assurance"><ShieldCheck size={16}/>HTTP-only sessions and server-side repository permissions.</div></form><footer className="auth-bottom">A thoughtful workspace for people who build things.<span>v0.1.0</span></footer></section></div>}
function Shell({user,logout,newRepo,children}){const nav=[["/","Overview",LayoutDashboard],["/repositories","Repositories",FolderGit2],["/issues","Issues",CircleDot],["/pull-requests","Pull requests",GitPullRequest],["/activity","Activity",Activity]];return <div className="shell"><aside className="sidebar"><Link to="/" className="brand"><Mark/><b>codevault<span>.</span></b></Link><div className="workspace"><b>Personal workspace</b><small>@{user.username}</small></div><small className="nav-label">WORKSPACE</small><nav>{nav.map(([to,label,Icon])=><NavLink end={to==="/"} to={to} key={to} className={({isActive})=>isActive?"nav active":"nav"}><Icon size={17}/>{label}</NavLink>)}</nav><small className="nav-label">YOUR PROJECTS <button onClick={newRepo}>+</button></small><Projects/><div className="learn-card"><b>Learn as you build.</b><p>Understand branches, commits and merges while you work.</p><Link to="/learning">Explore Learning Mode →</Link></div><div className="profile"><span>{user.username?.slice(0,2).toUpperCase()}</span><div><b>{user.displayName||user.username}</b><small>@{user.username}</small></div><button onClick={logout}><LogOut size={16}/></button></div></aside><main className="main"><header className="topbar"><span>Workspace <ChevronRight size={13}/> <b>CodeVault</b></span><div className="top-actions"><Link className="search" to="/issues"><Search size={15}/> Issues</Link><Btn onClick={newRepo}><Plus size={15}/> New repository</Btn></div></header><div className="content">{children}</div></main></div>}
function Projects(){const [repos,setRepos]=useState([]);useEffect(()=>{api.get("/repositories?limit=5").then(r=>setRepos(r.data.repositories||[])).catch(()=>{});},[]);return <nav>{repos.map(r=><Link className="nav" to={"/repositories/"+r._id} key={r._id}><FolderGit2 size={15}/>{r.name}</Link>)}</nav>}
function Header({kicker,title,description,action}){return <div className="page-head"><div><small>{kicker}</small><h1>{title}</h1><p>{description}</p></div>{action}</div>}
function Panel({title,detail,children}){return <section className="panel"><header><div><h2>{title}</h2><p>{detail}</p></div></header>{children}</section>}
function RepoRow({repo}){return <Link className="repo-row" to={"/repositories/"+repo._id}><span><FolderGit2 size={18}/></span><div><b>{repo.name}</b><small>{repo.description||"No description yet."}</small><small><GitBranch size={12}/>{repo.defaultBranch||"main"} · updated {date(repo.updatedAt)}</small></div><ChevronRight size={16}/></Link>}
function Dashboard({user,newRepo}){const [data,setData]=useState(null),[error,setError]=useState("");useEffect(()=>{api.get("/analytics/overview").then(r=>setData(r.data)).catch(e=>setError(e.message));},[]);const stats=[["Repositories",data?.summary?.repositories??"—",FolderGit2],["Open issues",data?.summary?.openIssues??"—",CircleDot],["Commits · 7 days",data?.summary?.commitsLast7Days??"—",GitCommitHorizontal],["Collaborators",data?.summary?.collaborators??"—",Users]];return <div className="page"><div className="welcome"><div><small>A GOOD DAY TO SHIP SOMETHING</small><h1>Good morning, {(user.displayName||user.username).split(" ")[0]}<i>.</i></h1><p>Your code, your people, your next good idea — all in one place.</p></div><button className="btn lime" onClick={newRepo}><Plus size={16}/> Create repository</button></div>{error&&<div className="error">{error}</div>}<div className="stats">{stats.map(([n,v,Icon])=><div className="stat" key={n}><span>{n}<Icon size={16}/></span><b>{v}</b><small>From accessible repositories</small></div>)}</div><div className="grid"><Panel title="Your repositories" detail="The places where your work takes shape.">{data?.repositories?.length?data.repositories.map(r=><RepoRow repo={r} key={r._id}/>):<Empty title="Start with a clean commit" body="Create your first repository. CodeVault will initialise a real Git repository with a README." action="Create repository" onAction={newRepo}/>}</Panel><Panel title="Contribution rhythm" detail="Seven days of actual Git activity.">{data?.activity?.length?<div className="chart">{data.activity.map(d=><div key={d.date} title={d.date+": "+d.commits+" commits"}><span style={{height:Math.max(3,d.commits/Math.max(1,...data.activity.map(x=>x.commits))*100)+"%"}}/><small>{d.label}</small></div>)}</div>:<Empty title="No commits to chart yet" body="The dashboard will show repository history after your first commit."/>}<p className="note">No seeded stats; all counts come from the API.</p></Panel></div></div>}
function NewRepo({close,created}){const [form,setForm]=useState({name:"",description:"",visibility:"private",addReadme:true,gitignore:"Node",license:"MIT"}),[busy,setBusy]=useState(false),[error,setError]=useState("");const change=e=>setForm({...form,[e.target.name]:e.target.type==="checkbox"?e.target.checked:e.target.value});const submit=async e=>{e.preventDefault();setBusy(true);setError("");try{const r=await api.post("/repositories",form);created(r.data.repository);}catch(x){setError(x.message);}finally{setBusy(false);}};return <div className="scrim" onClick={e=>e.target===e.currentTarget&&close()}><section className="modal" role="dialog" aria-modal="true"><header><div><small>A GOOD PLACE TO BEGIN</small><h2>Create a repository</h2><p>Every useful change starts somewhere.</p></div><button onClick={close}><X size={18}/></button></header><form className="form" onSubmit={submit}><label>Repository name<input name="name" value={form.name} onChange={change} pattern="[A-Za-z0-9._-]+" maxLength="80" required placeholder="campus-events"/></label><label>Description<textarea name="description" value={form.description} onChange={change} maxLength="350" rows="2" placeholder="What are you building?"/></label><label>Visibility<select name="visibility" value={form.visibility} onChange={change}><option value="private">Private</option><option value="public">Public</option></select></label><label className="checkbox"><input type="checkbox" name="addReadme" checked={form.addReadme} onChange={change}/>Initialize with README</label><div className="grid two"><label>.gitignore<select name="gitignore" value={form.gitignore} onChange={change}><option>Node</option><option>Python</option><option>Java</option><option>VisualStudioCode</option><option>None</option></select></label><label>License<select name="license" value={form.license} onChange={change}><option>MIT</option><option>Apache-2.0</option><option>GPL-3.0</option><option>None</option></select></label></div>{error&&<div className="error">{error}</div>}<footer><button type="button" className="btn outline" onClick={close}>Cancel</button><button className="btn dark" disabled={busy}>{busy&&<Spin/>}Create repository <ArrowRight size={15}/></button></footer></form></section></div>}
function Repositories({newRepo}){const [repos,setRepos]=useState([]),[error,setError]=useState("");useEffect(()=>{api.get("/repositories").then(r=>setRepos(r.data.repositories||[])).catch(e=>setError(e.message));},[]);return <div className="page"><Header kicker="YOUR SOURCE OF TRUTH" title="Repositories" description="Projects, branches, and all the history that got you here." action={<Btn onClick={newRepo}><Plus size={15}/> New repository</Btn>}/><Panel title="All repositories" detail="Only accessible repositories appear here.">{error&&<div className="error">{error}</div>}{repos.length?repos.map(r=><RepoRow key={r._id} repo={r}/>):<Empty title="No repositories yet" body="Create a repository to start versioning source code with Git." action="Create repository" onAction={newRepo}/>}</Panel></div>}
function RepoPage({notify}){
 const {id}=useParams();
 const [repo,setRepo]=useState(null),[permission,setPermission]=useState(null),[tab,setTab]=useState("overview"),[branch,setBranch]=useState("main");
 const [branches,setBranches]=useState([]),[files,setFiles]=useState([]),[commits,setCommits]=useState([]),[issues,setIssues]=useState([]),[collaborators,setCollaborators]=useState([]);
 const [selectedFile,setSelectedFile]=useState(""),[fileContent,setFileContent]=useState(""),[editing,setEditing]=useState(false),[commitMessage,setCommitMessage]=useState(""),[saving,setSaving]=useState(false);
 const [selectedCommit,setSelectedCommit]=useState(null),[diff,setDiff]=useState(""),[loadingDiff,setLoadingDiff]=useState(false);
 const [branchName,setBranchName]=useState(""),[branchBase,setBranchBase]=useState("main");
 const [fileInsight,setFileInsight]=useState(""),[fileHistory,setFileHistory]=useState([]),[fileBlame,setFileBlame]=useState([]),[fileInsightLoading,setFileInsightLoading]=useState(false),[deletingBranch,setDeletingBranch]=useState("");
 const [insights,setInsights]=useState(null),[insightsLoading,setInsightsLoading]=useState(false),[insightRef,setInsightRef]=useState("all");
 const [dependencyReport,setDependencyReport]=useState(null),[dependencyLoading,setDependencyLoading]=useState(false);
 const [protectionRules,setProtectionRules]=useState([]),[protectionPattern,setProtectionPattern]=useState("main"),[protectionApprovals,setProtectionApprovals]=useState(1),[protectionPR,setProtectionPR]=useState(true),[protectionResolved,setProtectionResolved]=useState(true),[protectionStale,setProtectionStale]=useState(true),[protectionDeleting,setProtectionDeleting]=useState("");

 const [codeQuery,setCodeQuery]=useState(""),[codeSearch,setCodeSearch]=useState(null),[searching,setSearching]=useState(false);
 const [graph,setGraph]=useState(null),[graphRef,setGraphRef]=useState("all"),[loadingGraph,setLoadingGraph]=useState(false),[graphCommit,setGraphCommit]=useState(null),[compareBase,setCompareBase]=useState(""),[compareTarget,setCompareTarget]=useState(""),[comparison,setComparison]=useState(null),[comparing,setComparing]=useState(false),[snapshotRef,setSnapshotRef]=useState("");
 const [releaseItems,setReleaseItems]=useState([]),[gitTags,setGitTags]=useState([]),[releaseName,setReleaseName]=useState(""),[releaseTag,setReleaseTag]=useState(""),[releaseNotes,setReleaseNotes]=useState(""),[releaseTarget,setReleaseTarget]=useState("main"),[publishingRelease,setPublishingRelease]=useState(false);
 const [mergeSource,setMergeSource]=useState(""),[mergeTarget,setMergeTarget]=useState("main"),[mergePreview,setMergePreview]=useState(null),[merging,setMerging]=useState(false);
 const [mergeResolutions,setMergeResolutions]=useState([]),[mergeConflictSubmitting,setMergeConflictSubmitting]=useState(false);
 const [issueStatus,setIssueStatus]=useState("open"),[issueTitle,setIssueTitle]=useState(""),[issueDescription,setIssueDescription]=useState(""),[issuePriority,setIssuePriority]=useState("medium"),[expandedIssue,setExpandedIssue]=useState(null),[issueDetail,setIssueDetail]=useState(null),[comment,setComment]=useState("");
 const [memberUsername,setMemberUsername]=useState(""),[memberRole,setMemberRole]=useState("developer");
 const [pullRequests,setPullRequests]=useState([]),[selectedPr,setSelectedPr]=useState(null),[prDetail,setPrDetail]=useState(null),[prTitle,setPrTitle]=useState(""),[prDescription,setPrDescription]=useState(""),[prSource,setPrSource]=useState(""),[prTarget,setPrTarget]=useState("main"),[prDecision,setPrDecision]=useState("approved"),[prReviewBody,setPrReviewBody]=useState("");
 const [prDiff,setPrDiff]=useState(""),[prDiffSha,setPrDiffSha]=useState(""),[prDiffLoading,setPrDiffLoading]=useState(false),[prCommentPath,setPrCommentPath]=useState(""),[prCommentLine,setPrCommentLine]=useState(0),[prCommentBody,setPrCommentBody]=useState(""),[prCommentBusy,setPrCommentBusy]=useState(false),[prReverting,setPrReverting]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[loading,setLoading]=useState(true);
 const canWrite=["owner","maintainer","developer"].includes(permission),canManage=["owner","maintainer"].includes(permission);
 const activeRef = snapshotRef || branch;
 const loadBranches=async()=>{const r=await api.get("/repositories/"+id+"/branches");setBranches(r.data.branches||[]);};
 const loadProtectionRules=async()=>{const r=await api.get("/repositories/"+id+"/branch-protection");setProtectionRules(r.data.rules||[]);};
 const loadContributionInsights=async(ref=insightRef)=>{setInsightsLoading(true);setError("");try{const r=await api.get("/repositories/"+id+"/insights",{params:{ref,days:90}});setInsights(r.data.insights);}catch(e){setError(e.message);}finally{setInsightsLoading(false);}};
 const loadDependencyReport=async(ref=branch)=>{setDependencyLoading(true);setError("");try{const r=await api.get("/repositories/"+id+"/dependencies",{params:{ref}});setDependencyReport(r.data.report);}catch(e){setError(e.message);}finally{setDependencyLoading(false);}};

 const loadFiles=async()=>{const r=await api.get("/repositories/"+id+"/files",{params:{ref:activeRef}});setFiles(r.data.files||[]);};
 const loadCommits=async()=>{const r=await api.get("/repositories/"+id+"/commits",{params:{ref:activeRef,limit:100}});setCommits(r.data.commits||[]);};
 const loadIssues=async()=>{const r=await api.get("/repositories/"+id+"/issues",{params:{status:issueStatus}});setIssues(r.data.issues||[]);};
 const loadCollaborators=async()=>{const r=await api.get("/repositories/"+id+"/collaborators");setCollaborators(r.data.collaborators||[]);};
 const loadPullRequests=async()=>{const r=await api.get("/pull-requests",{params:{repository:id,limit:100}});setPullRequests(r.data.pullRequests||[]);};
 const loadReleases=async()=>{const r=await api.get("/repositories/"+id+"/releases");setReleaseItems(r.data.releases||[]);setGitTags(r.data.tags||[]);};
 useEffect(()=>{let active=true;setLoading(true);setError("");api.get("/repositories/"+id).then(async r=>{if(!active)return;setRepo(r.data.repository);setPermission(r.data.permission);setBranch(r.data.repository.defaultBranch||"main");setBranchBase(r.data.repository.defaultBranch||"main");setProtectionPattern(r.data.repository.defaultBranch||"main");setMergeTarget(r.data.repository.defaultBranch||"main");setReleaseTarget(r.data.repository.defaultBranch||"main");try{const b=await api.get("/repositories/"+id+"/branches");if(active)setBranches(b.data.branches||[]);}catch(e){if(active)setError(e.message);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[id]);
 useEffect(()=>{let active=true;Promise.all([api.get("/repositories/"+id+"/files",{params:{ref:activeRef}}),api.get("/repositories/"+id+"/commits",{params:{ref:activeRef,limit:100}})]).then(([f,c])=>{if(active){setFiles(f.data.files||[]);setCommits(c.data.commits||[]);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id,activeRef]);
 useEffect(()=>{if(tab==="issues")loadIssues().catch(e=>setError(e.message));if(tab==="collaborators")loadCollaborators().catch(e=>setError(e.message));if(tab==="pull-requests")loadPullRequests().catch(e=>setError(e.message));if(tab==="releases")loadReleases().catch(e=>setError(e.message));if(tab==="branches"){loadProtectionRules().catch(e=>setError(e.message));loadBranches().catch(e=>setError(e.message));}if(tab==="insights")loadContributionInsights("all");if(tab==="dependencies")loadDependencyReport();},[id,tab,issueStatus]);
 const openFile=async file=>{setSelectedFile(file.path);setEditing(false);setFileInsight("");setFileHistory([]);setFileBlame([]);setNotice("");setError("");try{const r=await api.get("/repositories/"+id+"/files/content",{params:{ref:activeRef,path:file.path}});setFileContent(r.data.content);setCommitMessage("Update "+file.path);}catch(e){setError(e.message);}};
 const loadFileInsight=async mode=>{if(!selectedFile)return;setFileInsight(mode);setFileInsightLoading(true);setError("");try{const r=await api.get("/repositories/"+id+"/files/"+mode,{params:{ref:activeRef,path:selectedFile,limit:50}});if(mode==="history")setFileHistory(r.data.history||[]);else setFileBlame(r.data.lines||[]);}catch(e){setError(e.message);}finally{setFileInsightLoading(false);}};
 const createBranchFromCommit=commit=>{setBranchName("feature/from-"+sha(commit.sha));setBranchBase(commit.sha);setTab("branches");setNotice("Choose a name and create a branch from "+sha(commit.sha)+".");};
 const deleteRepositoryBranch=async item=>{if(!window.confirm("Delete branch "+item.name+"? Git will refuse if it contains commits not merged into the default branch. The default branch cannot be deleted."))return;setDeletingBranch(item.name);setError("");try{await api.delete("/repositories/"+id+"/branches",{data:{name:item.name,expectedHead:item.sha}});setNotice("Deleted merged branch "+item.name+".");if(branch===item.name){setBranch(repo.defaultBranch);setSelectedFile("");setFileContent("");setSnapshotRef("");}await loadBranches();}catch(e){setError(e.message);}finally{setDeletingBranch("");}};
 const saveFile=async e=>{e.preventDefault();setSaving(true);setError("");setNotice("");try{const r=await api.post("/repositories/"+id+"/commits",{branch,path:selectedFile,content:fileContent,message:commitMessage});setEditing(false);setNotice("Committed "+selectedFile+" · "+sha(r.data.commit.sha));await Promise.all([loadFiles(),loadCommits(),loadBranches()]);}catch(e){setError(e.message);}finally{setSaving(false);}};
 const inspectCommit=async c=>{setSelectedCommit(c);setLoadingDiff(true);setDiff("");try{const r=await api.get("/repositories/"+id+"/commits/"+c.sha+"/diff");setDiff(r.data.diff||"No textual diff was returned.");}catch(e){setError(e.message);}finally{setLoadingDiff(false);}};
 const loadGraph=async()=>{setLoadingGraph(true);setError("");try{const r=await api.get("/repositories/"+id+"/graph",{params:{ref:graphRef,limit:200}});setGraph(r.data);}catch(e){setError(e.message);}finally{setLoadingGraph(false);}};
 useEffect(()=>{if(tab==="graph")loadGraph();},[id,tab,graphRef]);
 const selectGraphCommit=commit=>{setGraphCommit(commit);setCompareTarget(commit.sha);setCompareBase(commit.parents?.[0]||"");inspectCommit(commit);};
 const compareSelectedCommits=async e=>{e.preventDefault();if(!compareBase||!compareTarget||compareBase===compareTarget)return;setComparing(true);setError("");setComparison(null);try{const r=await api.get("/repositories/"+id+"/compare",{params:{base:compareBase,target:compareTarget}});setComparison(r.data);}catch(e){setError(e.message);}finally{setComparing(false);}};
 const browseCommitSnapshot=async commit=>{setSnapshotRef(commit.sha);setSelectedFile("");setFileContent("");setEditing(false);setTab("files");};
 const runCodeSearch=async e=>{e.preventDefault();if(!codeQuery.trim())return;setSearching(true);setError("");setCodeSearch(null);try{const r=await api.get("/repositories/"+id+"/search",{params:{q:codeQuery,ref:branch,limit:200}});setCodeSearch(r.data);}catch(e){setError(e.message);}finally{setSearching(false);}};

 
 const saveProtectionRule=async e=>{e.preventDefault();setError("");try{const payload={pattern:protectionPattern.trim(),requirePullRequest:protectionPR,requiredApprovals:Number(protectionApprovals),requireResolvedConversations:protectionResolved,dismissStaleApprovals:protectionStale,preventDeletion:true};await api.put("/repositories/"+id+"/branch-protection",payload);await loadProtectionRules();setNotice("Saved branch protection for "+payload.pattern+".");}catch(e){setError(e.message);}};
 const removeProtectionRule=async rule=>{if(!window.confirm("Remove branch protection for "+rule.pattern+"? Direct writes to this branch may become available again."))return;setProtectionDeleting(rule.pattern);setError("");try{await api.delete("/repositories/"+id+"/branch-protection",{data:{pattern:rule.pattern}});await loadProtectionRules();setNotice("Removed branch protection for "+rule.pattern+".");}catch(e){setError(e.message);}finally{setProtectionDeleting("");}};
const createBranch=async e=>{e.preventDefault();setError("");try{const name=branchName.trim();await api.post("/repositories/"+id+"/branches",{name,base:branchBase});setBranchName("");setSnapshotRef("");setBranch(name);await loadBranches();setNotice("Created branch "+name+".");}catch(e){setError(e.message);}};
 const updateMergeResolution=(filePath,patch)=>setMergeResolutions(items=>items.map(item=>item.path===filePath?{...item,...patch}:item));
 const chooseMergeSide=(file,side)=>{const content=file[side];updateMergeResolution(file.path,{content:content||"",delete:content===null});};
 const runMergePreview=async e=>{e.preventDefault();setError("");setMergePreview(null);setMergeResolutions([]);try{const r=await api.post("/repositories/"+id+"/merge-preview",{source:mergeSource,target:mergeTarget});setMergePreview(r.data);setMergeResolutions((r.data.conflictFiles||[]).map(file=>({path:file.path,content:file.merged||"",delete:false})));}catch(e){setError(e.message);}};
 const performResolvedMerge=async()=>{if(!mergePreview||mergePreview.canMerge||!mergePreview.conflictFiles?.length)return;const unavailable=mergePreview.conflictFiles.filter(file=>!file.canEdit);if(unavailable.length){setError("Some conflicts are binary or otherwise unsupported by the text editor.");return;}setMergeConflictSubmitting(true);setError("");try{const r=await api.post("/repositories/"+id+"/merge-resolve",{source:mergeSource,target:mergeTarget,expectedHead:mergePreview.targetHead,expectedSourceSha:mergePreview.sourceSha,resolutions:mergeResolutions});setNotice("Resolved "+(r.data.result.resolvedFiles?.length||0)+" files and merged "+mergeSource+" into "+mergeTarget+".");setMergePreview(null);setMergeResolutions([]);await Promise.all([loadBranches(),loadCommits(),loadFiles()]);if(tab==="graph")await loadGraph();}catch(e){setError(e.message);}finally{setMergeConflictSubmitting(false);}};
 const performMerge=async()=>{if(!mergePreview?.canMerge)return;setMerging(true);setError("");try{await api.post("/repositories/"+id+"/merge",{source:mergeSource,target:mergeTarget,expectedHead:mergePreview.targetHead});setNotice("Merged "+mergeSource+" into "+mergeTarget+".");setMergePreview(null);await Promise.all([loadBranches(),loadCommits()]);}catch(e){setError(e.message);}finally{setMerging(false);}};
 const publishRelease=async e=>{e.preventDefault();setPublishingRelease(true);setError("");try{const r=await api.post("/repositories/"+id+"/releases",{name:releaseName,tagName:releaseTag,notes:releaseNotes,targetBranch:releaseTarget});setReleaseItems(v=>[r.data.release,...v]);setReleaseName("");setReleaseTag("");setReleaseNotes("");await loadReleases();setNotice("Published release "+r.data.release.tagName+".");}catch(e){setError(e.message);}finally{setPublishingRelease(false);}};
 const createIssue=async e=>{e.preventDefault();setError("");try{const r=await api.post("/repositories/"+id+"/issues",{title:issueTitle,description:issueDescription,priority:issuePriority,labels:[]});setIssues(v=>[r.data.issue,...v]);setIssueTitle("");setIssueDescription("");setNotice("Created issue #"+r.data.issue.number+".");}catch(e){setError(e.message);}};
 const toggleIssue=async item=>{setError("");try{const r=await api.patch("/issues/"+item._id,{status:item.status==="open"?"closed":"open"});setIssues(v=>v.map(x=>x._id===item._id?r.data.issue:x));if(expandedIssue===item._id)setIssueDetail(r.data.issue);setNotice(item.status==="open"?"Issue closed.":"Issue reopened.");}catch(e){setError(e.message);}};
 const expandIssue=async item=>{if(expandedIssue===item._id){setExpandedIssue(null);setIssueDetail(null);return;}setExpandedIssue(item._id);try{const r=await api.get("/issues/"+item._id);setIssueDetail(r.data.issue);}catch(e){setError(e.message);}};
 const sendComment=async e=>{e.preventDefault();if(!expandedIssue||!comment.trim())return;try{const r=await api.post("/issues/"+expandedIssue+"/comments",{body:comment});setIssueDetail(v=>v?{...v,comments:r.data.comments}:v);setComment("");}catch(e){setError(e.message);}};
 const addCollaborator=async e=>{e.preventDefault();setError("");try{const r=await api.post("/repositories/"+id+"/collaborators",{username:memberUsername,role:memberRole});setCollaborators(v=>[...v,r.data.collaborator]);setMemberUsername("");setNotice("Added @"+r.data.collaborator.user.username+" as "+memberRole+".");}catch(e){setError(e.message);}};
 const createPullRequest=async e=>{e.preventDefault();setError("");try{const r=await api.post("/pull-requests",{repositoryId:id,title:prTitle,description:prDescription,sourceBranch:prSource,targetBranch:prTarget});setPullRequests(v=>[r.data.pullRequest,...v]);setSelectedPr(r.data.pullRequest._id);setPrDetail(r.data.pullRequest);setPrTitle("");setPrDescription("");setNotice("Created pull request #"+r.data.pullRequest.number+".");}catch(e){setError(e.message);}};
 const openPullRequest=async item=>{setSelectedPr(item._id);setError("");setPrDiffLoading(true);setPrDetail(null);setPrDiff("");setPrDiffSha("");try{const detail=await api.get("/pull-requests/"+item._id);setPrDetail(detail.data.pullRequest);try{const diffResult=await api.get("/pull-requests/"+item._id+"/diff");setPrDiff(diffResult.data.diff||"");setPrDiffSha(diffResult.data.sourceSha||"");}catch(e){setError("Pull-request details loaded, but the current diff is unavailable: "+e.message);}}catch(e){setError(e.message);}finally{setPrDiffLoading(false);}};

 const submitInlineComment=async e=>{e.preventDefault();if(!selectedPr||!prDiffSha||!prCommentPath||!prCommentLine||!prCommentBody.trim())return;setPrCommentBusy(true);setError("");try{const r=await api.post("/pull-requests/"+selectedPr+"/comments",{path:prCommentPath,line:prCommentLine,side:"RIGHT",commitSha:prDiffSha,body:prCommentBody});setPrDetail(r.data.pullRequest);setPrCommentBody("");setNotice("Inline review comment added.");}catch(e){setError(e.message);}finally{setPrCommentBusy(false);}};
 const toggleInlineThread=async thread=>{if(!selectedPr)return;setError("");try{const r=await api.patch("/pull-requests/"+selectedPr+"/comments/"+thread._id,{resolved:!thread.resolved});setPrDetail(r.data.pullRequest);setNotice(thread.resolved?"Review thread reopened.":"Review thread resolved.");}catch(e){setError(e.message);}};
 const refreshPrDiff=async()=>{if(!selectedPr)return;setPrDiffLoading(true);setError("");try{const r=await api.get("/pull-requests/"+selectedPr+"/diff");setPrDiff(r.data.diff||"");setPrDiffSha(r.data.sourceSha||"");setPrCommentPath("");setPrCommentLine(0);}catch(e){setError(e.message);}finally{setPrDiffLoading(false);}};
 const revertSelectedCommit=async commit=>{const currentHead=branches.find(item=>item.name===branch)?.sha;if(!currentHead){setError("Refresh branches before reverting this commit.");return;}if(!window.confirm("Create a new commit that reverses "+sha(commit.sha)+" on "+branch+"? Existing history will not be rewritten."))return;setPrReverting(true);setError("");try{const r=await api.post("/repositories/"+id+"/revert",{branch,commitSha:commit.sha,expectedHead:currentHead});setNotice("Created revert commit "+sha(r.data.revert.revertCommit)+".");setSelectedCommit(null);setGraphCommit(null);setDiff("");await Promise.all([loadBranches(),loadCommits(),loadFiles()]);if(tab==="graph")await loadGraph();}catch(e){setError(e.message);}finally{setPrReverting(false);}};
 const reviewPullRequest=async e=>{e.preventDefault();if(!selectedPr)return;setError("");try{const r=await api.post("/pull-requests/"+selectedPr+"/reviews",{decision:prDecision,body:prReviewBody});setPrDetail(r.data.pullRequest);setPrReviewBody("");setNotice("Review submitted.");}catch(e){setError(e.message);}};
 const mergePullRequest=async()=>{if(!selectedPr)return;setError("");try{const r=await api.post("/pull-requests/"+selectedPr+"/merge");setPrDetail(r.data.pullRequest);await loadPullRequests();setNotice("Pull request merged successfully.");}catch(e){setError(e.message);}};
 const closePullRequest=async()=>{if(!selectedPr)return;setError("");try{const r=await api.post("/pull-requests/"+selectedPr+"/close");setPrDetail(r.data.pullRequest);await loadPullRequests();setNotice("Pull request closed.");}catch(e){setError(e.message);}};

 if(loading)return <div className="loading"><Spin/>Loading repository…</div>;
 if(error&&!repo)return <div className="page"><div className="error"><AlertCircle size={15}/>{error}</div><Link className="text-link" to="/repositories">Back to repositories</Link></div>;
 if(!repo)return <div className="loading"><Spin/>Loading repository…</div>;
 const tabs=[["overview","Overview"],["files","Files"],["search","Code search"],["commits","Commits"],["graph","History graph"],["releases","Releases"],["branches","Branches"],["insights","Insights"],["dependencies","Dependencies"],["merge","Merge"],["pull-requests","Pull requests"],["issues","Issues"],["collaborators","People"]];
 return <div className="page">
  <div className="repo-crumb"><Link to="/repositories">Repositories</Link><ChevronRight size={13}/><b>{repo.name}</b><span className="badge">{repo.visibility}</span></div>
  <div className="repo-title"><span className="repo-icon"><FolderGit2 size={22}/></span><div><h1>{repo.name}</h1><p>{repo.description||"Source, version history, and project work."}</p><small>Owned by {repo.owner?.username||"member"} · default branch {repo.defaultBranch}</small></div></div>
  <div className="repo-tabs">{tabs.map(([v,label])=><button key={v} className={tab===v?"selected":""} onClick={()=>{setTab(v);setError("");setNotice("");}}>{label}{v==="branches"&&branches.length>0?<span className="badge">{branches.length}</span>:null}{v==="issues"?<span className="badge">{issues.length||""}</span>:null}</button>)}</div>
  {error&&<div className="error"><AlertCircle size={15}/>{error}</div>}{notice&&<div className="notice"><Check size={14}/>{notice}<button onClick={()=>setNotice("")}>Dismiss</button></div>}
  {tab==="overview"&&<div className="repo-layout">
   <div className="stack">
    <Panel title="Recent commits" detail="Actual Git history on the selected branch.">{commits.slice(0,6).length?commits.slice(0,6).map(c=><button className="commit clickable" key={c.sha} onClick={()=>{setTab("commits");inspectCommit(c);}}><GitCommitHorizontal size={16}/><span><b>{c.message}</b><small>{c.author} · {date(c.date)}</small></span><code>{sha(c.sha)}</code></button>):<Empty title="First commit, first milestone." body="Create a repository with a README or commit your first file."/>}</Panel>
    <Panel title="Open issues" detail="Tasks and decisions that need attention.">{issues.filter(x=>x.status==="open").slice(0,4).map(i=><div className="issue-row" key={i._id}><CircleDot size={15}/><span>#{i.number}</span><b>{i.title}</b></div>)}<button className="text-link" onClick={()=>setTab("issues")}>Open issue tracker →</button></Panel>
   </div>
   <div className="stack">
    <Panel title="Repository details" detail="Project metadata and access."><div className="facts"><div><span>Visibility</span><b>{repo.visibility==="private"?<LockKeyhole size={13}/>:<Globe2 size={13}/>} {repo.visibility}</b></div><div><span>Default branch</span><b><GitBranch size={13}/>{repo.defaultBranch}</b></div><div><span>Permission</span><b>{permission}</b></div><div><span>Created</span><b>{date(repo.createdAt)}</b></div></div></Panel>
    <div className="tip"><b>QUICK START</b><p>Clone your repository to work locally with Git.</p><code>git clone &lt;repository-url&gt;</code></div>
   </div>
  </div>}
  {tab==="files"&&<Panel title="Source files" detail={snapshotRef?"Read-only historical commit snapshot.":"Read or edit a committed text file."}>{snapshotRef&&<div className="snapshot-banner"><History size={14}/><span>Browsing historical snapshot <code>{sha(snapshotRef)}</code></span><button className="text-link" onClick={()=>{setSnapshotRef("");setSelectedFile("");setFileContent("");setEditing(false);}}>Return to {branch}</button></div>}<div className="file-toolbar"><label className="branch-select"><GitBranch size={14}/><select value={branch} onChange={e=>{setSnapshotRef("");setBranch(e.target.value);setSelectedFile("");setEditing(false);}} disabled={Boolean(snapshotRef)}>{branches.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</select><ChevronDown size={13}/></label><span className="note">{files.length} tracked files</span></div><div className="file-browser"><div className="file-list">{files.length?files.map(f=><button key={f.path} className={selectedFile===f.path?"selected":""} onClick={()=>openFile(f)}><FileCode2 size={14}/>{f.path}</button>):<p>No tracked files on this branch.</p>}</div><div className="file-view"><div className="file-head"><FileCode2 size={14}/>{selectedFile||"Select a file"}<span className="badge">{snapshotRef?"SNAPSHOT":"GIT REF"}</span></div>{selectedFile?(editing?<form className="form file-editor" onSubmit={saveFile}><label>File contents<textarea value={fileContent} onChange={e=>setFileContent(e.target.value)} rows="18" spellCheck="false" required/></label><label>Commit message<input value={commitMessage} onChange={e=>setCommitMessage(e.target.value)} minLength="3" maxLength="180" required/></label><div className="edit-actions"><button type="button" className="btn outline small" onClick={()=>setEditing(false)}>Cancel</button><button className="btn dark small" disabled={saving}>{saving&&<Spin/>}Commit changes <GitCommitHorizontal size={14}/></button></div></form>:<><pre>{fileContent}</pre><div className="file-actions">{canWrite&&!snapshotRef&&<button className="btn dark small" onClick={()=>setEditing(true)}>Edit and commit <GitCommitHorizontal size={14}/></button>}<button className="btn outline small" onClick={()=>loadFileInsight("history")}><History size={14}/> File history</button><button className="btn outline small" onClick={()=>loadFileInsight("blame")}><Clock3 size={14}/> Git blame</button></div></>):<div className="file-placeholder"><Code2 size={24}/><b>Pick a file to inspect it</b><p>Content is read directly from the selected Git ref.</p></div>}</div></div>
    {fileInsight&&<div className="file-insights">
     <div className="file-insight-head"><div><b>{fileInsight==="history"?"File history":"Line blame"}</b><small>{selectedFile} · {sha(activeRef)}</small></div><button type="button" className="text-link" onClick={()=>setFileInsight("")}>Close</button></div>
     {fileInsightLoading?<div className="loading"><Spin/>Loading {fileInsight}…</div>:fileInsight==="history"?fileHistory.length?fileHistory.map(item=><button className="file-history-row" key={item.sha} onClick={()=>{setTab("commits");inspectCommit(item);}}><GitCommitHorizontal size={14}/><span><b>{item.message}</b><small>{item.author} · {date(item.date)}</small></span><code>{sha(item.sha)}</code></button>):<p className="note">No history found for this file at the selected ref.</p>:fileBlame.length?<div className="blame-table">{fileBlame.map(item=><div className="blame-row" key={item.line}><small>{item.line}</small><span><code>{sha(item.sha)}</code><b>{item.author}</b><time>{item.authorTime?date(item.authorTime):"—"}</time></span><pre>{item.content||" "}</pre></div>)}</div>:<p className="note">No blame information found for this file.</p>}
    </div>}
   </Panel>}
  {tab==="search"&&<Panel title="Search source code" detail="Find an exact phrase across tracked text files in the selected Git branch.">
   <form className="form code-search-form" onSubmit={runCodeSearch}>
    <label>Search phrase<input value={codeQuery} onChange={e=>setCodeQuery(e.target.value)} maxLength="100" placeholder="Function name, variable, text or exact phrase…" required/></label>
    <div className="code-search-controls">
     <label className="branch-select"><GitBranch size={14}/><select value={branch} onChange={e=>{setBranch(e.target.value);setCodeSearch(null);}}>{branches.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</select><ChevronDown size={13}/></label>
     <button className="btn dark small" disabled={searching||!codeQuery.trim()}>{searching?<Spin/>:<Search size={14}/>} Search code</button>
    </div>
   </form>
   {searching&&<div className="loading"><Spin/>Searching committed files…</div>}
   {codeSearch&&<div className="code-search-summary"><b>{codeSearch.results.length} {codeSearch.results.length===1?"match":"matches"}</b><span>for <code>{codeSearch.query}</code> on <code>{codeSearch.ref}</code></span></div>}
   {codeSearch?.results?.length?<div className="code-search-results">{codeSearch.results.map((hit,i)=><button className="code-result" key={hit.path+":"+hit.line+":"+i} onClick={()=>{setTab("files");openFile({path:hit.path});}}>
    <span className="code-result-path"><FileCode2 size={14}/><b>{hit.path}</b><small>line {hit.line}</small></span>
    <code>{hit.snippet||" "}</code>
   </button>)}</div>:null}
   {codeSearch&&!codeSearch.results.length&&<Empty title="No matches found" body="Try a shorter phrase, check the selected branch, or search for a different symbol."/>}
   {codeSearch?.truncated&&<p className="note">Showing the first {codeSearch.results.length} matches. Refine your phrase to narrow the results.</p>}
   <p className="note">Search reads committed text from Git. Binary files and untracked working files are excluded.</p>
  </Panel>}
  {tab==="commits"&&<><Panel title="Commit history" detail="Every entry comes from the Git object database."><div className="file-toolbar"><label className="branch-select"><GitBranch size={14}/><select value={branch} onChange={e=>{setBranch(e.target.value);setSelectedCommit(null);}}>{branches.map(b=><option value={b.name} key={b.name}>{b.name}</option>)}</select></label><span className="note">{commits.length} commits loaded</span></div>{commits.length?commits.map(c=><button className="commit clickable" key={c.sha} onClick={()=>inspectCommit(c)}><GitCommitHorizontal size={16}/><span><b>{c.message}</b><small>{c.author} · {date(c.date)}</small></span><code>{sha(c.sha)}</code></button>):<Empty title="No commits found" body="This branch has no visible history yet."/>}</Panel>{selectedCommit&&<Panel title="Commit diff" detail={selectedCommit.message}><div className="diff-meta"><span>{selectedCommit.author}</span><code>{selectedCommit.sha}</code><button className="text-link" onClick={()=>{setSelectedCommit(null);setDiff("");}}>Close</button>{canWrite&&<button className="btn outline small" onClick={()=>revertSelectedCommit(selectedCommit)} disabled={prReverting}><RefreshCw size={13}/>Revert commit</button>}</div>{loadingDiff?<div className="loading"><Spin/>Loading actual Git diff…</div>:<pre className="diff-view">{diff}</pre>}</Panel>}</>}

  {tab==="graph"&&<div className="stack">
   <Panel title="Commit graph" detail="Follow the real Git commit DAG across branches, merges and tags. Select any node to inspect its history.">
    <div className="file-toolbar graph-toolbar">
     <label className="branch-select"><GitBranch size={14}/><select value={graphRef} onChange={e=>{setGraphRef(e.target.value);setGraphCommit(null);setComparison(null);}}><option value="all">All branches</option>{branches.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select><ChevronDown size={13}/></label>
     <span className="note">{graph?.commits?.length||0} commits · {graph?.branches?.length||0} branches · {graph?.tags?.length||0} tags</span>
     <button className="btn outline small" onClick={loadGraph} disabled={loadingGraph}><RefreshCw size={13}/> Refresh</button>
    </div>
    {loadingGraph?<div className="loading"><Spin/>Loading real Git history…</div>:graph?.commits?.length?(()=>{
      const layout=arrangeCommitGraph(graph.commits);
      const selectedSha=graphCommit?.sha;
      return <div className="commit-graph-scroll"><div className="commit-graph-grid" style={{gridTemplateColumns:layout.width+"px minmax(0,1fr)"}}>
       <svg className="commit-graph-svg" width={layout.width} height={layout.height} viewBox={"0 0 "+layout.width+" "+layout.height} role="img" aria-label="Commit graph with parent relationships">
        {layout.edges.map((edge,i)=>{const x1=12+edge.from*24,x2=12+edge.to*24,y1=edge.start*56+28,y2=edge.end*56+28,mid=(y1+y2)/2;return <path key={"edge-"+i} d={"M "+x1+" "+y1+" C "+x1+" "+mid+", "+x2+" "+mid+", "+x2+" "+y2} className={edge.merge?"graph-edge merge":"graph-edge"}/>;})}
        {layout.nodes.map(node=><circle key={node.sha} cx={12+node.lane*24} cy={node.index*56+28} r={selectedSha===node.sha?7:5} className={selectedSha===node.sha?"graph-node selected":"graph-node"}/>)}
       </svg>
       <div className="commit-graph-rows">{graph.commits.map((commit,i)=><button key={commit.sha} className={graphCommit?.sha===commit.sha?"graph-commit selected":"graph-commit"} style={{height:56}} onClick={()=>selectGraphCommit(commit)}>
        <span className="graph-commit-main"><b>{commit.message||"Untitled commit"}</b><small>{commit.author} · {date(commit.date)}</small></span>
        <span className="graph-commit-meta">{commit.refs?.map(ref=><span className={"graph-ref "+ref.type} key={ref.type+ref.name}>{ref.type==="branch"?<GitBranch size={10}/>:<Tag size={10}/>} {ref.name}</span>)}<code>{sha(commit.sha)}</code></span>
       </button>)}</div>
      </div></div>;
    })():<Empty title="No commit history found" body="Create a commit or choose another branch to inspect its history."/>}
    {graph?.truncated&&<p className="note">Showing the newest 200 commits. Choose a branch to focus the history on a smaller range.</p>}
   </Panel>
   {graphCommit&&<Panel title="Selected commit" detail={graphCommit.message}>
    <div className="selected-commit-meta"><span><GitCommitHorizontal size={16}/>{graphCommit.author}</span><span><Clock3 size={14}/>{graphCommit.date?new Date(graphCommit.date).toLocaleString():"—"}</span><code>{graphCommit.sha}</code></div>
    <div className="graph-navigation">
     <div><small>PARENT COMMITS · GO BACK</small>{graphCommit.parents?.length?graphCommit.parents.map(parent=><button className="text-link" key={parent} onClick={()=>{const item=graph?.commits.find(c=>c.sha===parent);if(item)selectGraphCommit(item);}}>{sha(parent)} <ArrowRight size={12}/></button>):<span className="note">Initial commit</span>}</div>
     <div><small>CHILD COMMITS · GO FORWARD</small>{graph?.commits.filter(item=>item.parents?.includes(graphCommit.sha)).length?graph.commits.filter(item=>item.parents?.includes(graphCommit.sha)).map(item=><button className="text-link" key={item.sha} onClick={()=>selectGraphCommit(item)}>{sha(item.sha)} · {item.message}</button>):<span className="note">No newer commits in this graph window</span>}</div>
    </div>
    <div className="graph-commit-actions">{canWrite&&<button className="btn lime small" onClick={()=>createBranchFromCommit(graphCommit)}><GitBranch size={14}/> Create branch here</button>}<button className="btn dark small" onClick={()=>browseCommitSnapshot(graphCommit)}><FileCode2 size={14}/> Browse this snapshot</button><button className="btn outline small" onClick={()=>{setTab("commits");setSelectedCommit(graphCommit);}}><GitCommitHorizontal size={14}/> Open commit diff</button>{canWrite&&<button className="btn outline small" onClick={()=>revertSelectedCommit(graphCommit)} disabled={prReverting}><RefreshCw size={13}/> Revert on {branch}</button>}</div>
    {loadingDiff?<div className="loading"><Spin/>Loading commit diff…</div>:<pre className="diff-view graph-diff">{diff||"No textual diff was returned for this commit."}</pre>}
   </Panel>}
   <Panel title="Compare any two commits" detail="Choose a base and target to inspect the exact file changes between snapshots.">
    <form className="form compare-form" onSubmit={compareSelectedCommits}>
     <label>Base commit<select value={compareBase} onChange={e=>{setCompareBase(e.target.value);setComparison(null);}}><option value="">Choose base</option>{(graph?.commits||[]).map(item=><option key={item.sha} value={item.sha}>{sha(item.sha)} · {item.message}</option>)}</select></label>
     <ArrowLeftRight size={17}/>
     <label>Target commit<select value={compareTarget} onChange={e=>{setCompareTarget(e.target.value);setComparison(null);}}><option value="">Choose target</option>{(graph?.commits||[]).map(item=><option key={item.sha} value={item.sha}>{sha(item.sha)} · {item.message}</option>)}</select></label>
     <button className="btn dark small" disabled={comparing||!compareBase||!compareTarget||compareBase===compareTarget}>{comparing?<Spin/>:<GitFork size={14}/>} Compare commits</button>
    </form>
    {comparison&&<><div className="diff-meta"><span>Base <code>{sha(comparison.base)}</code></span><span>Target <code>{sha(comparison.target)}</code></span><button className="text-link" onClick={()=>setComparison(null)}>Clear</button></div><pre className="diff-view">{comparison.diff||"No differences between these commits."}</pre></>}
   </Panel>
  </div>}
  {tab==="branches"&&<div className="stack">
   <div className="repo-layout">
    <Panel title="Branches" detail="Named refs pointing to real Git commits.">{branches.map(b=><div className="branch-row" key={b.name}><GitBranch size={15}/><div><b>{b.name}</b><small>{sha(b.sha)}</small></div>{b.name===repo.defaultBranch?<span className="badge">Default · Protected</span>:canWrite&&<button className="text-link branch-delete" onClick={()=>deleteRepositoryBranch(b)} disabled={deletingBranch===b.name}>{deletingBranch===b.name?<Spin/>:<X size={13}/>} Delete</button>}</div>)}</Panel>
    <Panel title="Create a branch" detail="Start from a branch or historical commit."><form className="form" onSubmit={createBranch}><label>Branch name<input value={branchName} onChange={e=>setBranchName(e.target.value)} placeholder="feature/search" pattern="[A-Za-z0-9_./-]+" maxLength="120" required/></label><label>Start from<select value={branchBase} onChange={e=>setBranchBase(e.target.value)}>{branches.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}{branchBase&&!branches.some(b=>b.name===branchBase)&&<option value={branchBase}>{sha(branchBase)} · selected commit</option>}</select></label><button className="btn dark full" disabled={!canWrite}><Plus size={14}/>Create branch</button></form></Panel>
   </div>
   <Panel title="Branch protection" detail="Rules are enforced by the API for direct commits, branch merges and pull-request merges.">
    {protectionRules.length?<div className="protection-rule-list">{protectionRules.map(rule=><div className="protection-rule-row" key={rule._id}><div><b><ShieldCheck size={14}/>{rule.pattern}</b><small>{rule.requirePullRequest?"Pull request required":"Direct pushes allowed"} · {rule.requiredApprovals} approval(s) · {rule.requireResolvedConversations?"Conversations must be resolved":"Conversation resolution optional"}</small></div>{canManage&&<button className="text-link" onClick={()=>removeProtectionRule(rule)} disabled={protectionDeleting===rule.pattern}>{protectionDeleting===rule.pattern?<Spin/>:"Remove"}</button>}</div>)}</div>:<p className="note">No custom branch rules yet. Create a rule to require reviews before code reaches a sensitive branch.</p>}
    {canManage&&<form className="form protection-form" onSubmit={saveProtectionRule}>
     <div className="form-two"><label>Branch pattern<input value={protectionPattern} onChange={e=>setProtectionPattern(e.target.value)} placeholder="main or release/*" pattern="[A-Za-z0-9._/*?-]+" maxLength="120" required/></label><label>Required independent approvals<select value={protectionApprovals} onChange={e=>setProtectionApprovals(Number(e.target.value))}>{Array.from({length:11},(_,n)=><option value={n} key={n}>{n}</option>)}</select></label></div>
     <label className="protection-check"><input type="checkbox" checked={protectionPR} onChange={e=>setProtectionPR(e.target.checked)}/> Require all changes to go through a pull request</label>
     <label className="protection-check"><input type="checkbox" checked={protectionResolved} onChange={e=>setProtectionResolved(e.target.checked)}/> Require all inline review conversations to be resolved</label>
     <label className="protection-check"><input type="checkbox" checked={protectionStale} onChange={e=>setProtectionStale(e.target.checked)}/> Dismiss approvals when the source branch changes</label>
     <button className="btn dark small" disabled={!protectionPattern.trim()}><ShieldCheck size={14}/> Save protection rule</button>
    </form>}
    {!canManage&&<p className="note">Only repository owners and maintainers can change protection rules.</p>}
   </Panel>
  </div>}
  {tab==="dependencies"&&<div className="stack">
   <Panel title="Dependency security" detail="Resolved npm versions are checked against OSV vulnerability data. The scanner never guesses installed versions from semver ranges.">
    <div className="insight-toolbar"><label>Branch<select value={branch} onChange={e=>{setSnapshotRef("");setBranch(e.target.value);}}>{branches.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label><button className="btn dark small" onClick={()=>loadDependencyReport(branch)} disabled={dependencyLoading}>{dependencyLoading?<Spin/>:<RefreshCw size={13}/>} Scan dependencies</button></div>
    {dependencyLoading?<div className="loading"><Spin/>Reading dependency manifests and querying OSV…</div>:dependencyReport&&<>
     {dependencyReport.status==="lockfile_required"?<div className="dependency-warning"><ShieldCheck size={17}/><div><b>Lockfile required for vulnerability scanning</b><p>This branch has {dependencyReport.manifestCount} npm manifest(s), but no committed <code>package-lock.json</code> or <code>npm-shrinkwrap.json</code>. The package ranges below are an inventory only; they are not treated as exact installed versions, and no clean security result is claimed.</p></div></div>:dependencyReport.status==="no_npm_manifest"?<div className="dependency-warning"><AlertCircle size={17}/><div><b>No npm package manifest found</b><p>This scanner supports npm lockfiles and exact pinned Python requirements (for example, requests==2.31.0).</p></div></div>:<div className="dependency-summary">
      <div><b>{dependencyReport.packageCount}</b><small>Resolved packages</small></div><div><b>{dependencyReport.vulnerabilityCount||0}</b><small>Vulnerability IDs</small></div><div><b>{dependencyReport.summary?.critical||0}</b><small>Critical findings</small></div><div><b>{dependencyReport.summary?.high||0}</b><small>High findings</small></div>
     </div>}
     {dependencyReport.status==="scanned"&&<>
      {dependencyReport.truncated&&<p className="note">The result was capped to keep the scan responsive. Some packages or vulnerability details may not be shown.</p>}
      {dependencyReport.findings?.length?<div className="dependency-findings">{dependencyReport.findings.map((finding,index)=><article className="dependency-finding" key={finding.id+"-"+finding.package+"-"+index}><div><b>{finding.package} <code>{finding.version}</code></b><span className={"badge severity-"+finding.severity}>{finding.severity}</span></div><p>{finding.summary}</p><small>{finding.id}{finding.fixedVersions?.length?" · fixed in "+finding.fixedVersions.join(", "):" · no fixed version listed"}</small><a href={finding.url} target="_blank" rel="noreferrer">View advisory</a></article>)}</div>:<div className="dependency-clean"><ShieldCheck size={18}/><div><b>No known vulnerabilities returned for scanned versions</b><p>This result reflects the OSV data available at {date(dependencyReport.scannedAt)} and is not a guarantee that packages are risk-free.</p></div></div>}
      <div className="dependency-package-list"><b>Scanned packages</b>{dependencyReport.dependencies?.slice(0,100).map(item=><div key={item.name+"@"+item.version}><span>{item.name}</span><code>{item.version}</code></div>)}</div>
     </>}
     {dependencyReport.status==="lockfile_required"&&dependencyReport.dependencies?.length>0&&<div className="dependency-package-list"><b>Manifest dependency inventory</b>{dependencyReport.dependencies.map(item=><div key={item.manifest+"-"+item.name}><span>{item.name}<small>{item.scope} · {item.manifest}</small></span><code>{item.requested}</code></div>)}</div>}
     <p className="note">Source: OSV.dev. Scan time: {date(dependencyReport.scannedAt)}. Branch: {dependencyReport.ref}.</p>
    </>}
   </Panel>
  </div>}
 
  {tab==="insights"&&<div className="stack">
   <Panel title="Repository contribution activity" detail="Git-derived contribution history across all branches, excluding merge commits.">
    <div className="insight-toolbar"><label>History scope<select value={insightRef} onChange={e=>{setInsightRef(e.target.value);loadContributionInsights(e.target.value);}}><option value="all">All branches</option>{branches.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label><button className="btn outline small" onClick={()=>loadContributionInsights(insightRef)} disabled={insightsLoading}><RefreshCw size={13}/> Refresh</button></div>
    {insightsLoading?<div className="loading"><Spin/>Calculating Git insights…</div>:insights&&<>
     <div className="insight-metrics"><div><b>{insights.totalCommits}</b><small>Commits · 90 days</small></div><div><b>{insights.contributorCount}</b><small>Contributors</small></div><div><b>{insights.additions.toLocaleString()}</b><small>Lines added</small></div><div><b>{insights.deletions.toLocaleString()}</b><small>Lines removed</small></div></div>
     <div className="insight-heatmap-panel"><div className="insight-section-title"><b>Contribution heatmap</b><small>Each square represents a day of Git activity.</small></div><div className="heatmap-grid">{Array.from({length:insights.daily?.[0]?.weekday||0},(_,index)=><i key={"pad-"+index}/>)}{insights.daily?.map(day=><span key={day.date} className={"heat-cell level-"+(day.commits===0?0:day.commits===1?1:day.commits<=3?2:day.commits<=6?3:4)} title={day.date+" · "+day.commits+" commit(s)"} aria-label={day.date+" "+day.commits+" commits"}/>)}</div><div className="heatmap-legend"><small>Less</small>{[0,1,2,3,4].map(level=><i key={level} className={"heat-cell level-"+level}/>)}<small>More</small><small className="heatmap-window">{insights.windowDays}-day window</small></div></div>
    </>}
   </Panel>
   {insights&&!insightsLoading&&<div className="repo-layout">
    <Panel title="Top contributors" detail="Ranked by non-merge commits in the selected window.">{insights.authors?.length?insights.authors.map((author,index)=><div className="insight-rank-row" key={author.name}><span>{index+1}</span><div><b>{author.name}</b><div className="insight-bar"><i style={{width:(author.commits/Math.max(1,...insights.authors.map(x=>x.commits))*100)+"%"}}/></div><small>{author.commits} commits · last {date(author.lastCommit)}</small></div></div>):<p className="note">No authored commits were found in this window.</p>}</Panel>
    <Panel title="Most changed files" detail="Files touched most often, with line totals.">{insights.hotFiles?.length?insights.hotFiles.map(file=><div className="hot-file-row" key={file.path}><b>{file.path}</b><small>{file.changes} change(s) · +{file.additions}/−{file.deletions}</small></div>):<p className="note">No file changes were found in this window.</p>}<p className="note">Binary file changes are counted separately: {insights.binaryFiles||0}.</p></Panel>
   </div>}
  </div>}
 
  {tab==="merge"&&<div className="stack">
   <Panel title="Merge preview" detail="Compare two branches before applying the merge."><form className="form merge-form" onSubmit={runMergePreview}><label>Source branch<select value={mergeSource} onChange={e=>{setMergeSource(e.target.value);setMergePreview(null);setMergeResolutions([]);}}><option value="">Choose a branch</option>{branches.map(b=><option value={b.name} key={b.name}>{b.name}</option>)}</select></label><label>Target branch<select value={mergeTarget} onChange={e=>{setMergeTarget(e.target.value);setMergePreview(null);setMergeResolutions([]);}}>{branches.map(b=><option value={b.name} key={b.name}>{b.name}</option>)}</select></label><button className="btn dark" disabled={!mergeSource||mergeSource===mergeTarget}><GitMerge size={15}/>Preview merge</button></form>{mergePreview&&<div className={mergePreview.canMerge?"merge-result ok":"merge-result conflict"}>
    <b>{mergePreview.canMerge?"No conflicts detected":"Merge conflicts detected"}</b>
    <p>{mergePreview.canMerge?"The changes can be merged into "+mergePreview.target+".":"Review the three versions of each conflicting file, prepare a resolved version, and apply it as a merge commit."}</p>
    {mergePreview.files?.length>0&&<div className="merge-files">{mergePreview.files.map((f,i)=><span key={i}>{f.status} · {f.path}</span>)}</div>}
    {mergePreview.conflicts?.length>0&&!mergePreview.conflictFiles?.length&&<div className="merge-files">{mergePreview.conflicts.map((f,i)=><span key={i}>{String(f)}</span>)}</div>}
    {mergePreview.canMerge&&canManage&&<button className="btn dark small" disabled={merging} onClick={performMerge}>{merging&&<Spin/>}Merge {mergeSource} into {mergeTarget} <GitMerge size={14}/></button>}
    {!mergePreview.canMerge&&mergePreview.conflictFiles?.length>0&&<div className="merge-conflict-editor">
     <div className="merge-editor-note"><ShieldCheck size={15}/><span>Preview is pinned to target <code>{sha(mergePreview.targetHead)}</code> and source <code>{sha(mergePreview.sourceSha)}</code>. The target branch will change only if both heads still match when you apply the merge.</span></div>
     {mergePreview.conflictFiles.map(file=>{
      const resolution=mergeResolutions.find(item=>item.path===file.path)||{content:"",delete:false};
      return <article className="merge-conflict-file" key={file.path}>
       <div className="merge-conflict-title"><div><b>{file.path}</b><small>{file.canEdit?"Text conflict":"Unsupported file conflict"}</small></div><span className="badge">Needs resolution</span></div>
       {file.canEdit?<><div className="merge-three-way">
        <section><div><b>Base</b><button type="button" className="text-link" onClick={()=>chooseMergeSide(file,"base")} disabled={file.base===null}>Use base</button></div><pre>{file.base===null?"File did not exist at the merge base.":file.base||"(empty file)"}</pre></section>
        <section><div><b>Target · ours</b><button type="button" className="text-link" onClick={()=>chooseMergeSide(file,"ours")} disabled={file.ours===null}>Use target</button></div><pre>{file.ours===null?"File is deleted on target.":file.ours||"(empty file)"}</pre></section>
        <section><div><b>Source · theirs</b><button type="button" className="text-link" onClick={()=>chooseMergeSide(file,"theirs")} disabled={file.theirs===null}>Use source</button></div><pre>{file.theirs===null?"File is deleted on source.":file.theirs||"(empty file)"}</pre></section>
       </div>
       <label className="merge-resolution-label">Resolved file contents<textarea value={resolution.content} onChange={e=>updateMergeResolution(file.path,{content:e.target.value,delete:false})} rows="10" spellCheck="false" disabled={resolution.delete}/></label>
       <label className="merge-delete-option"><input type="checkbox" checked={Boolean(resolution.delete)} onChange={e=>updateMergeResolution(file.path,{delete:e.target.checked,content:e.target.checked?"":resolution.content})}/> Delete this file in the merge result</label>
       </>:<p className="note">{file.reason||"This file type cannot be edited in the browser merge resolver."}</p>}
      </article>;
     })}
     {canManage&&<button className="btn dark" onClick={performResolvedMerge} disabled={mergeConflictSubmitting||mergePreview.conflictFiles.some(file=>!file.canEdit)||mergeResolutions.length!==mergePreview.conflictFiles.length}>{mergeConflictSubmitting?<Spin/>:<GitMerge size={15}/>} Apply resolutions and create merge commit</button>}
    </div>}
   </div>}</Panel>
   <p className="note">Only repository owners and maintainers can perform merges. Developers can create branches and preview changes.</p>
  </div>}
  {tab==="pull-requests"&&<div className="stack">
   <Panel title="Pull requests" detail="Propose changes, collect independent reviews, and merge a reviewed branch.">
    {canWrite&&<form className="form pr-create" onSubmit={createPullRequest}><label>Pull-request title<input value={prTitle} onChange={e=>setPrTitle(e.target.value)} maxLength="180" required placeholder="Describe the change"/></label><label>Description<textarea value={prDescription} onChange={e=>setPrDescription(e.target.value)} maxLength="12000" rows="2" placeholder="What changed and why?"/></label><div className="form-two"><label>Source branch<select value={prSource} onChange={e=>setPrSource(e.target.value)} required><option value="">Choose source</option>{branches.filter(b=>b.name!==prTarget).map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</select></label><label>Target branch<select value={prTarget} onChange={e=>setPrTarget(e.target.value)}>{branches.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</select></label></div><button className="btn dark small" disabled={!prSource||prSource===prTarget}><Plus size={14}/>Open pull request</button></form>}
    {pullRequests.length?pullRequests.map(pr=><button className="pr-row" key={pr._id} onClick={()=>openPullRequest(pr)}><GitPullRequest size={16}/><span><b>#{pr.number} {pr.title}</b><small>{pr.sourceBranch} → {pr.targetBranch} · by @{pr.author?.username||"member"}</small></span><span className={"badge "+(pr.status==="merged"?"green":"")}>{pr.status}</span><ChevronRight size={14}/></button>):<Empty title="No pull requests yet" body="Create one from a feature branch to start a review."/>}
   </Panel>
   {prDetail&&<Panel title={"#"+prDetail.number+" · "+prDetail.title} detail={prDetail.sourceBranch+" → "+prDetail.targetBranch+" · "+prDetail.status}>
    <p className="pr-description">{prDetail.description||"No description provided."}</p>
    <section className="inline-review-workspace">
     <div className="inline-review-heading"><div><b>Changed lines</b><small>Select an added line to leave a review comment.</small></div><button className="btn outline small" onClick={refreshPrDiff} disabled={prDiffLoading}><RefreshCw size={13}/> Refresh diff</button></div>
     {prDiffLoading?<div className="loading"><Spin/>Loading pull-request changes…</div>:prDiff?<div className="pr-diff-view">{parseReviewDiff(prDiff).map((row,index)=>row.type==="added"?<button type="button" key={index} className={"pr-diff-line added"+(prCommentPath===row.path&&prCommentLine===row.line?" selected":"")} onClick={()=>{setPrCommentPath(row.path);setPrCommentLine(row.line);}}>
      <span>+</span><small>{row.line}</small><code>{row.text||" "}</code><em>Comment</em>
     </button>:<div className={"pr-diff-line "+row.type} key={index}><span>{row.type==="removed"?"−":""}</span><small>{row.line||""}</small><code>{row.text||" "}</code></div>)}</div>:<Empty title="No textual changes available" body="The source and target branches may be identical, or the diff may contain only binary changes."/>}
     {prCommentPath&&permission&&<form className="form inline-comment-form" onSubmit={submitInlineComment}>
      <div><b>Comment on {prCommentPath}:{prCommentLine}</b><button type="button" className="text-link" onClick={()=>{setPrCommentPath("");setPrCommentLine(0);}}>Cancel</button></div>
      <label>Review comment<textarea value={prCommentBody} onChange={e=>setPrCommentBody(e.target.value)} rows="3" maxLength="5000" placeholder="Explain what should change or ask a question…" required/></label>
      <button className="btn dark small" disabled={prCommentBusy||!prCommentBody.trim()}>{prCommentBusy?<Spin/>:<MessageSquare size={14}/>} Add inline comment</button>
     </form>}
     <div className="inline-threads"><div className="inline-review-heading"><div><b>Review threads</b><small>{prDetail.reviewThreads?.filter(thread=>!thread.resolved).length||0} unresolved</small></div></div>
      {prDetail.reviewThreads?.length?prDetail.reviewThreads.map(thread=><article className={"inline-thread"+(thread.resolved?" resolved":"")} key={thread._id}>
       <div><b>@{thread.author?.username||"member"}</b><code>{thread.path}:{thread.line}</code><span className="badge">{thread.resolved?"Resolved":"Open"}</span></div>
       <p>{thread.body}</p>
       <small>{date(thread.createdAt)}{thread.resolvedBy?.username?" · resolved by @"+thread.resolvedBy.username:""}</small>
       {permission&&<button className="text-link" onClick={()=>toggleInlineThread(thread)}>{thread.resolved?"Reopen thread":"Resolve thread"}</button>}
      </article>):<p className="note">No line-level discussions yet. Select an added line above to start one.</p>}
     </div>
    </section>
    <div className="review-list"><b>Reviews</b>{prDetail.reviews?.length?prDetail.reviews.map((review,i)=><div className="review-row" key={review.user?._id||i}><span className="badge">{review.decision.replace("_"," ")}</span><b>@{review.user?.username||"reviewer"}</b><small>{date(review.submittedAt)}</small>{review.body&&<p>{review.body}</p>}</div>):<p className="note">No reviews submitted yet. A collaborator must approve before merge.</p>}</div>
    {prDetail.status==="open"&&<form className="form pr-review-form" onSubmit={reviewPullRequest}><label>Your review<select value={prDecision} onChange={e=>setPrDecision(e.target.value)}><option value="approved">Approve</option><option value="changes_requested">Request changes</option><option value="commented">Comment</option></select></label><label>Review note<textarea value={prReviewBody} onChange={e=>setPrReviewBody(e.target.value)} rows="2" maxLength="5000" placeholder="Feedback for the author (optional)."/></label><button className="btn outline small"><MessageSquare size={14}/>Submit review</button></form>}
    {prDetail.mergeCommit&&<p className="note">Merged commit: <code>{prDetail.mergeCommit}</code></p>}
    {prDetail.status==="open"&&<div className="pr-actions">{canManage&&<button className="btn dark small" onClick={mergePullRequest}><GitMerge size={14}/>Merge reviewed pull request</button>}<button className="btn outline small" onClick={closePullRequest}>Close pull request</button></div>}
   </Panel>}
  </div>}
  {tab==="releases"&&<div className="repo-layout">
   {canManage&&<Panel title="Publish a release" detail="Create an annotated Git tag and save release notes for this repository.">
    <form className="form release-form" onSubmit={publishRelease}>
     <label>Release title<input value={releaseName} onChange={e=>setReleaseName(e.target.value)} maxLength="120" placeholder="First stable release" required/></label>
     <label>Tag name<input value={releaseTag} onChange={e=>setReleaseTag(e.target.value)} maxLength="128" pattern="[A-Za-z0-9][A-Za-z0-9._/-]*" placeholder="v1.0.0" required/></label>
     <label>Target branch<select value={releaseTarget} onChange={e=>setReleaseTarget(e.target.value)}>{branches.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</select></label>
     <label>Release notes<textarea value={releaseNotes} onChange={e=>setReleaseNotes(e.target.value)} rows="5" maxLength="5000" placeholder="Describe the improvements, fixes and changes included in this version." required/></label>
     <button className="btn dark full" disabled={publishingRelease||!releaseTag.trim()||!releaseName.trim()||!releaseNotes.trim()}>{publishingRelease?<Spin/>:<Tag size={14}/>}Publish release</button>
    </form>
   </Panel>}
   <div className="stack">
    <Panel title="Published releases" detail="Versioned snapshots created from real Git commits.">
     {releaseItems.length?releaseItems.map(item=><article className="release-card" key={item._id}>
      <div className="release-card-head"><span><Tag size={15}/><b>{item.name}</b></span><code>{item.tagName}</code></div>
      <p>{item.notes}</p>
      <small>{item.targetBranch} · {sha(item.targetSha)} · published {date(item.publishedAt)} by @{item.author?.username||"member"}</small>
     </article>):<Empty title="No releases published" body="Publish a version when your project reaches a useful milestone."/>}
    </Panel>
    <Panel title="Git tags" detail="Annotated and lightweight tags present in the repository.">
     {gitTags.length?gitTags.map(item=><div className="tag-row" key={item.name}><Tag size={14}/><b>{item.name}</b><code>{sha(item.commitSha)}</code><small>{item.subject||"Git tag"}</small></div>):<Empty title="No Git tags yet" body="Publishing a release creates an annotated tag on the selected branch."/>}
    </Panel>
   </div>
  </div>}
  {tab==="issues"&&<Panel title="Issue tracker" detail="Create, discuss and close repository work items."><div className="tabs issue-tabs">{["open","closed","all"].map(v=><button key={v} className={issueStatus===v?"selected":""} onClick={()=>setIssueStatus(v)}>{v}</button>)}</div>{canWrite&&<form className="issue-form form" onSubmit={createIssue}><label>Issue title<input value={issueTitle} onChange={e=>setIssueTitle(e.target.value)} placeholder="What needs to happen?" maxLength="180" required/></label><label>Description<textarea value={issueDescription} onChange={e=>setIssueDescription(e.target.value)} rows="3" maxLength="12000" placeholder="Context, expected behaviour and acceptance criteria."/></label><label>Priority<select value={issuePriority} onChange={e=>setIssuePriority(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><button className="btn dark small"><Plus size={14}/>Create issue</button></form>}{issues.length?issues.map(item=><article className="issue-card" key={item._id}><div className="issue-line"><CircleDot size={15}/><span>#{item.number}</span><b>{item.title}</b><span className="badge">{item.priority}</span><span className="badge">{item.status}</span>{canWrite&&<button className="btn outline small" onClick={()=>toggleIssue(item)}>{item.status==="open"?"Close":"Reopen"}</button>}<button className="icon-btn" title="Show discussion" onClick={()=>expandIssue(item)}><MessageSquare size={15}/></button></div>{expandedIssue===item._id&&<div className="issue-detail"><p>{issueDetail?.description||item.description||"No description."}</p>{(issueDetail?.comments||[]).map((c,i)=><div className="comment-row" key={c._id||i}><b>{c.author?.username||"Member"}</b><span>{c.body}</span><small>{date(c.createdAt)}</small></div>)}<form className="comment-form" onSubmit={sendComment}><input value={comment} onChange={e=>setComment(e.target.value)} maxLength="5000" placeholder="Add a comment…" required/><button className="btn dark small"><MessageSquare size={13}/>Comment</button></form></div>}</article>):<Empty title="No issues in this view" body="Create an issue to make the work visible."/>}</Panel>}
  {tab==="collaborators"&&<div className="repo-layout">
   <Panel title="People with access" detail="Accepted repository collaborators."><div className="collab-row owner"><span className="avatar">{(repo.owner?.username||"OW").slice(0,2).toUpperCase()}</span><div><b>{repo.owner?.displayName||repo.owner?.username}</b><small>@{repo.owner?.username} · Owner</small></div></div>{collaborators.map(c=><div className="collab-row" key={c._id}><span className="avatar">{(c.user?.username||"CV").slice(0,2).toUpperCase()}</span><div><b>{c.user?.displayName||c.user?.username}</b><small>@{c.user?.username} · {c.role}</small></div></div>)}</Panel>
   <Panel title="Add a collaborator" detail="The person must already have a CodeVault account."><form className="form" onSubmit={addCollaborator}><label>Username<input value={memberUsername} onChange={e=>setMemberUsername(e.target.value)} minLength="3" maxLength="30" pattern="[A-Za-z0-9_-]+" placeholder="teammate-handle" required/></label><label>Role<select value={memberRole} onChange={e=>setMemberRole(e.target.value)}><option value="developer">Developer</option><option value="viewer">Viewer</option><option value="maintainer">Maintainer</option></select></label><button className="btn dark full" disabled={!canManage}><UserPlus size={14}/>Add collaborator</button></form></Panel>
  </div>}
 </div>;
}



function ActivityIndex(){
 const [items,setItems]=useState([]),[error,setError]=useState(""),[busy,setBusy]=useState(true);
 useEffect(()=>{let active=true;api.get("/activity",{params:{limit:100}}).then(r=>{if(active)setItems(r.data.activities||[]);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
 return <div className="page">
  <Header kicker="THE STORY OF YOUR WORKSPACE" title="Activity" description="A live record of repository, issue, branch, release and review events you can access."/>
  <Panel title="Recent activity" detail="Events are recorded by CodeVault as work happens.">
   {error&&<div className="error">{error}</div>}
   {busy?<div className="loading"><Spin/>Loading workspace activity…</div>:items.length?<div className="activity-list">{items.map(item=><article className="activity-item" key={item._id}>
    <span className="activity-symbol"><Activity size={15}/></span>
    <div className="activity-copy"><p>{item.summary}</p><small>@{item.actor?.username||"Member"} · {item.repository?.name||"Workspace"} · {item.entityType?.replace("_"," ")||"event"}</small></div>
    <time>{item.createdAt?new Date(item.createdAt).toLocaleString():"—"}</time>
   </article>)}</div>:<Empty title="Your activity will appear here" body="Create a repository, commit a change, open an issue or publish a release to start the timeline."/>}
  </Panel>
 </div>;
}

function IssuesIndex(){
 const [items,setItems]=useState([]),[total,setTotal]=useState(0),[pages,setPages]=useState(1),[page,setPage]=useState(1);
 const [status,setStatus]=useState("open"),[priority,setPriority]=useState(""),[scope,setScope]=useState("all");
 const [draftSearch,setDraftSearch]=useState(""),[search,setSearch]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [expandedIssue,setExpandedIssue]=useState(null),[issueDetail,setIssueDetail]=useState(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState("");
 const [comment,setComment]=useState(""),[commentBusy,setCommentBusy]=useState(false),[updatingIssue,setUpdatingIssue]=useState("");
 useEffect(()=>{let active=true;setBusy(true);setError("");api.get("/issues",{params:{status,priority:priority||undefined,scope,search:search||undefined,page,limit:20}}).then(r=>{if(!active)return;setItems(r.data.issues||[]);setTotal(r.data.total||0);setPages(Math.max(1,r.data.pages||1));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[status,priority,scope,search,page]);
 useEffect(()=>{
  if(!expandedIssue){setIssueDetail(null);setDetailError("");return;}
  let active=true;setIssueDetail(null);setDetailError("");setDetailLoading(true);setComment("");
  api.get("/issues/"+expandedIssue).then(r=>{if(active)setIssueDetail(r.data.issue);}).catch(e=>{if(active)setDetailError(e.message);}).finally(()=>{if(active)setDetailLoading(false);});
  return()=>{active=false;};
 },[expandedIssue]);
 const applySearch=e=>{e.preventDefault();setPage(1);setSearch(draftSearch.trim());};
 const reset=()=>{setDraftSearch("");setSearch("");setStatus("open");setPriority("");setScope("all");setPage(1);};
 const toggleDiscussion=item=>setExpandedIssue(current=>current===item._id?null:item._id);
 const toggleIssueStatus=async item=>{
  if(!item.canWrite||updatingIssue)return;
  const nextStatus=item.status==="open"?"closed":"open";
  setUpdatingIssue(item._id);setError("");
  try{
   await api.patch("/issues/"+item._id,{status:nextStatus});
   if(status!=="all"&&nextStatus!==status){
    setItems(current=>current.filter(issue=>issue._id!==item._id));
    const nextTotal=Math.max(0,total-1),nextPages=Math.max(1,Math.ceil(nextTotal/20));
    setTotal(nextTotal);setPages(nextPages);
    if(page>nextPages)setPage(nextPages);
    setExpandedIssue(current=>current===item._id?null:current);
   }else{
    setItems(current=>current.map(issue=>issue._id===item._id?{...issue,status:nextStatus}:issue));
    setIssueDetail(current=>current?{...current,status:nextStatus}:current);
   }
  }catch(e){setError(e.message);}finally{setUpdatingIssue("");}
 };
 const sendComment=async e=>{
  e.preventDefault();if(!expandedIssue||!comment.trim()||commentBusy)return;
  setCommentBusy(true);setDetailError("");
  try{
   const r=await api.post("/issues/"+expandedIssue+"/comments",{body:comment.trim()});
   setIssueDetail(current=>current?{...current,comments:r.data.comments||[]}:current);
   setComment("");
  }catch(e){setDetailError(e.message);}finally{setCommentBusy(false);}
 };
 return <div className="page">
  <Header kicker="THE WORK THAT NEEDS ATTENTION" title="Issue inbox" description="A single view of work items across repositories you own or collaborate on."/>
  <Panel title="Find the next thing to fix" detail="Search issue titles, descriptions and labels. Results stay within repositories you can access.">
   <form className="form issue-global-filters" onSubmit={applySearch}>
    <label>Search issues<input value={draftSearch} onChange={e=>setDraftSearch(e.target.value)} maxLength="100" placeholder="Search title, context or label…"/></label>
    <div className="form-two">
     <label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All statuses</option></select></label>
     <label>Priority<select value={priority} onChange={e=>{setPriority(e.target.value);setPage(1);}}><option value="">Any priority</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
    </div>
    <div className="form-two">
     <label>Assigned to<select value={scope} onChange={e=>{setScope(e.target.value);setPage(1);}}><option value="all">Anyone</option><option value="assigned">Assigned to me</option><option value="created">Created by me</option><option value="unassigned">Unassigned</option></select></label>
     <div className="issue-filter-actions"><button className="btn dark small" type="submit"><Search size={14}/>Search</button><button className="btn outline small" type="button" onClick={reset}>Reset filters</button></div>
    </div>
   </form>
   {error&&<div className="error">{error}</div>}
   <div className="issue-inbox-summary"><b>{total} {total===1?"issue":"issues"}</b><span>{busy?"Refreshing…":total?("Page "+page+" of "+pages):"No matching work items"}</span></div>
   {items.length?items.map(item=><article className="issue-card global-issue-card" key={item._id}>
    <div className="issue-line"><CircleDot size={15}/><span>#{item.number}</span><b>{item.title}</b><span className="badge">{item.priority}</span><span className={"badge "+(item.status==="closed"?"green":"")}>{item.status}</span>
     {item.canWrite&&<button className="btn outline small" type="button" onClick={()=>toggleIssueStatus(item)} disabled={updatingIssue===item._id}>{updatingIssue===item._id?"Saving…":item.status==="open"?"Close":"Reopen"}</button>}
     <button className="btn outline small" type="button" onClick={()=>toggleDiscussion(item)} aria-expanded={expandedIssue===item._id}><MessageSquare size={13}/>{expandedIssue===item._id?"Hide discussion":"Discussion"}</button>
    </div>
    <p>{item.description||"No description was added to this issue."}</p>
    <div className="issue-inbox-meta"><span><FolderGit2 size={13}/>{item.repository?.name||"Repository"}</span><span>Opened by @{item.author?.username||"member"}</span><span>{item.assignee?.username?"Assigned to @"+item.assignee.username:"Unassigned"}</span><span>Updated {date(item.updatedAt)}</span></div>
    {expandedIssue===item._id&&<div className="issue-detail">
     {detailError&&<div className="error">{detailError}</div>}
     {detailLoading?<div className="note">Loading discussion…</div>:issueDetail?<>
      <p>{issueDetail.description||"No description was added to this issue."}</p>
      {(issueDetail.comments||[]).length?issueDetail.comments.map((entry,index)=><div className="comment-row" key={entry._id||index}><b>{entry.author?.username||"Member"}</b><span>{entry.body}</span><small>{date(entry.createdAt)}</small></div>):<div className="note">No comments yet. Start the discussion below.</div>}
      <form className="comment-form" onSubmit={sendComment}><input value={comment} onChange={e=>setComment(e.target.value)} maxLength="5000" placeholder="Add a comment…" required/><button className="btn dark small" disabled={commentBusy||!comment.trim()}>{commentBusy?<Spin/>:<MessageSquare size={13}/>}Comment</button></form>
     </>:<div className="note">The discussion could not be loaded.</div>}
    </div>}
    <Link className="text-link" to={"/repositories/"+item.repository?._id}>Open repository →</Link>
   </article>):(!busy?<Empty title="Nothing in this view" body="Try another status or scope, or create an issue from one of your repositories."/>:<div className="note">Loading issues…</div>)}
   <div className="issue-inbox-pagination"><button className="btn outline small" type="button" disabled={page<=1||busy} onClick={()=>setPage(v=>Math.max(1,v-1))}>Previous</button><span>{page} / {pages}</span><button className="btn outline small" type="button" disabled={page>=pages||busy} onClick={()=>setPage(v=>Math.min(pages,v+1))}>Next</button></div>
  </Panel>
 </div>;
}

function PullRequestsIndex(){const [items,setItems]=useState([]),[error,setError]=useState("");useEffect(()=>{api.get("/pull-requests",{params:{limit:100}}).then(r=>setItems(r.data.pullRequests||[])).catch(e=>setError(e.message));},[]);return <div className="page"><Header kicker="REVIEW THE WORK, NOT JUST THE DIFF" title="Pull requests" description="Changes proposed by you and your collaborators."/><Panel title="Accessible pull requests" detail="Open, merged and closed reviews across your repositories.">{error&&<div className="error">{error}</div>}{items.length?items.map(pr=><Link className="pr-row" key={pr._id} to={"/repositories/"+pr.repository?._id}><GitPullRequest size={16}/><span><b>#{pr.number} {pr.title}</b><small>{pr.repository?.name||"Repository"} · {pr.sourceBranch} → {pr.targetBranch} · @{pr.author?.username||"member"}</small></span><span className={"badge "+(pr.status==="merged"?"green":"")}>{pr.status}</span><ChevronRight size={14}/></Link>):<Empty title="No pull requests yet" body="Open a repository, create a feature branch and start a review."/>}</Panel></div>}
function LearningMode(){const cards=[["01","A commit is a snapshot","A commit records a tree of content, its parent commit, author, timestamp and message. It is a durable point in project history."],["02","A branch is a pointer","A branch is a named reference to a commit. Creating a branch does not copy the repository; it creates another pointer to the history."],["03","A diff explains a change","A diff compares two trees or commits and highlights additions, deletions and context. Read it before approving a pull request."],["04","A merge joins histories","A merge combines the histories of two branches. Conflicting edits need deliberate resolution before the result can be committed."],["05","A pull request is a proposal","A pull request links a source branch to a target branch, describes the intent and gives teammates a place to review changes."],["06","A review is an explicit decision","An approval communicates that a reviewer is comfortable with the proposed change. A change request tells the author what needs attention."]];return <div className="page"><Header kicker="LEARN THE MODEL, NOT JUST COMMANDS" title="Learning Mode" description="Short practical notes for understanding Git and explaining the workflow in your viva."/><div className="lessons">{cards.map(([n,title,body])=><article key={n}><small>{n} / FIELD NOTE</small><h2>{title}</h2><p>{body}</p></article>)}</div></div>}
function Simple({title,description,icon:Icon=Activity}){return <div className="page"><Header kicker="CODEVAULT" title={title} description={description}/><Panel title={title}><Empty title="No activity yet" body="This section will display data from your accessible repositories."/></Panel></div>}
export default function App(){const [user,setUser]=useState(null),[ready,setReady]=useState(false),[modal,setModal]=useState(false),[toast,setToast]=useState("");const nav=useNavigate();useEffect(()=>{api.get("/auth/me").then(r=>setUser(r.data.user)).catch(()=>setUser(null)).finally(()=>setReady(true));},[]);const notify=m=>{setToast(m);window.setTimeout(()=>setToast(""),3000);};const logout=async()=>{try{await api.post("/auth/logout");}catch{}setUser(null);nav("/login");};if(!ready)return <div className="boot"><Mark/><span>Preparing your workspace</span><Spin/></div>;if(!user)return <Routes><Route path="*" element={<Auth done={setUser}/>} /></Routes>;return <><Shell user={user} logout={logout} newRepo={()=>setModal(true)}><Routes><Route path="/" element={<Dashboard user={user} newRepo={()=>setModal(true)}/>} /><Route path="/repositories" element={<Repositories newRepo={()=>setModal(true)}/>} /><Route path="/repositories/:id/*" element={<RepoPage/>}/><Route path="/issues" element={<IssuesIndex/>} /><Route path="/pull-requests" element={<PullRequestsIndex/>}/><Route path="/activity" element={<ActivityIndex/>}/><Route path="/learning" element={<LearningMode/>}/><Route path="*" element={<Simple title="Page not found" description="This route is not available."/>}/></Routes></Shell>{modal&&<NewRepo close={()=>setModal(false)} created={r=>{setModal(false);notify("Repository created.");nav("/repositories/"+r._id);}}/>}{toast&&<div className="toast">{toast}<button onClick={()=>setToast("")}>×</button></div>}</>}
