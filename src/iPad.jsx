import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './iPad.css'; 
import { db, auth, loadUserData } from './firebase_config.jsx';
import { doc, getDoc, updateDoc, deleteDoc, addDoc, collection, query, orderBy, onSnapshot, serverTimestamp, getDocs } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const IPad = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [ipadData, setIpadData] = useState(null);
    const [projectQueue, setProjectQueue] = useState([]);
    const [workersMap, setWorkersMap] = useState({});
    const [dropdowns, setDropdowns] = useState({ companies: [], categories: [], sizes: [] });
    
    // Tab State
    const [activeTab, setActiveTab] = useState('live');
    
    // Permissions
    const [perms, setPerms] = useState({ timer: false, settings: false, fleet: false });

    // Timer Logic
    const [displayTime, setDisplayTime] = useState("00:00:00");
    const [now, setNow] = useState(new Date()); // Tracks live time for worker rows
    
    // Forms
    const [leaderEditMode, setLeaderEditMode] = useState(false);
    const [newLeaderId, setNewLeaderId] = useState('');
    const [setupMode, setSetupMode] = useState('queue'); // 'queue' or 'manual'
    const [selectedQueueIdx, setSelectedQueueIdx] = useState('');
    
    // Worker Edit State
    const [editingWorker, setEditingWorker] = useState(null); // { id, h, m }

    // Manual Form State
    const [manualForm, setManualForm] = useState({
        company: '', project: '', category: '', size: '', h: 0, m: 0, s: 0
    });

    // --- INITIALIZATION ---
    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            if (user) {
                loadUserData(user, async () => {
                    await checkPermissions(user);
                    initListeners();
                });
            } else {
                navigate('/');
            }
        });
        return () => unsubscribeAuth();
    }, [id]);

    const checkPermissions = async (user) => {
        const uSnap = await getDoc(doc(db, "users", user.email.toLowerCase()));
        if (!uSnap.exists()) return navigate('/');
        const role = uSnap.data().role;
        const rSnap = await getDoc(doc(db, "config", "roles"));
        if (role === 'admin') {
            setPerms({ timer: true, settings: true, fleet: true });
        } else if (rSnap.exists()) {
            const rc = rSnap.data()[role];
            setPerms({
                timer: rc['timer_edit'] || false,
                settings: rc['settings_edit'] || false,
                fleet: rc['fleet_edit'] || false
            });
        }
    };

    const initListeners = async () => {
        // 1. Listen to iPad
        const unsubIpad = onSnapshot(doc(db, "ipads", id), (snap) => {
            if (snap.exists()) {
                setIpadData(snap.data());
                setLoading(false);
            } else {
                alert("iPad not found");
                navigate('/');
            }
        });

        // 2. Listen to Queue
        const qQueue = query(collection(db, "project_queue"), orderBy("createdAt", "asc"));
        const unsubQueue = onSnapshot(qQueue, (snap) => {
            const list = [];
            snap.forEach(d => list.push({ id: d.id, ...d.data() }));
            setProjectQueue(list);
        });

        // 3. Fetch Configs & Workers
        const cSnap = await getDoc(doc(db, "config", "project_options"));
        if (cSnap.exists()) setDropdowns(cSnap.data());

        // --- FIXED WORKER MAPPING HERE ---
        const wSnap = await getDocs(collection(db, "workers"));
        const wMap = {};
        wSnap.forEach(d => {
            const w = d.data();
            const name = w.name || "Unknown Worker";
            wMap[d.id] = name; 
        });
        setWorkersMap(wMap);

        return () => { unsubIpad(); unsubQueue(); };
    };

    // --- TIMER LOGIC ---
    useEffect(() => {
        const interval = setInterval(() => {
            setNow(new Date()); // Update local 'now' for worker calculations
            if (!ipadData) return;
            
            let seconds = ipadData.secondsRemaining || 0;
            if (!ipadData.isPaused && ipadData.lastUpdateTime && (ipadData.activeWorkers || []).length > 0) {
                const currentNow = new Date();
                const last = new Date(ipadData.lastUpdateTime.seconds * 1000);
                const elapsed = Math.floor((currentNow - last) / 1000);
                const burned = elapsed * ipadData.activeWorkers.length;
                seconds = seconds - burned;
            }

            const isNeg = seconds < 0;
            const abs = Math.abs(seconds);
            const h = Math.floor(abs / 3600);
            const m = Math.floor((abs % 3600) / 60);
            const s = Math.floor(abs % 60);
            
            setDisplayTime(`${isNeg ? '-' : ''}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
        }, 1000);

        return () => clearInterval(interval);
    }, [ipadData]);

    // --- WORKER TIME CALCULATIONS ---
    const getWorkerTimeData = (wid) => {
        if (!ipadData || !ipadData.scanHistory) return { totalMinutes: 0, currentMinutes: 0, bankedMinutes: 0 };
        
        let bankedSeconds = 0;
        let lastClockIn = null;
        
        // Sort history safely
        const history = [...ipadData.scanHistory].sort((a,b) => (a.timestamp?.seconds||0) - (b.timestamp?.seconds||0));

        history.forEach(scan => {
            if (scan.cardID !== wid) return;
            if (scan.action.includes("In")) {
                lastClockIn = scan.timestamp?.seconds;
            } else if (scan.action.includes("Out") && lastClockIn) {
                bankedSeconds += (scan.timestamp.seconds - lastClockIn);
                lastClockIn = null;
            }
        });

        let currentSeconds = 0;
        // If currently active, add time since last Clock In
        if (lastClockIn && ipadData.activeWorkers && ipadData.activeWorkers.includes(wid)) {
            currentSeconds = Math.max(0, (now.getTime()/1000) - lastClockIn);
        }

        const totalMinutes = (bankedSeconds + currentSeconds) / 60;
        return {
            totalMinutes: totalMinutes,
            currentMinutes: currentSeconds / 60,
            bankedMinutes: bankedSeconds / 60
        };
    };

    const formatWorkerTime = (minutes) => {
        const h = Math.floor(minutes / 60);
        const m = Math.floor(minutes % 60);
        return `${h}h ${String(m).padStart(2, '0')}m`;
    };

    const startEditingWorker = (wid) => {
        const data = getWorkerTimeData(wid);
        const h = Math.floor(data.totalMinutes / 60);
        const m = Math.floor(data.totalMinutes % 60);
        setEditingWorker({ id: wid, h, m });
    };

    const saveWorkerTime = async () => {
        if (!editingWorker) return;
        const wid = editingWorker.id;
        
        // 1. Calculate desired Total
        const targetTotalMinutes = (parseInt(editingWorker.h)||0) * 60 + (parseInt(editingWorker.m)||0);
        
        // 2. Get current active session duration to subtract it
        const data = getWorkerTimeData(wid);
        const newBankedMinutes = targetTotalMinutes - data.currentMinutes;

        if (window.confirm(`Update hours to ${editingWorker.h}h ${editingWorker.m}m? \n\n⚠️ This will disqualify the project bonus.`)) {
            await updateDoc(doc(db, "ipads", id), {
                remoteCommand: `EDIT_WORKER|${wid}|${newBankedMinutes}`,
                commandTimestamp: serverTimestamp()
            });
            setEditingWorker(null);
        }
    };

    // --- ACTIONS ---

    const sendCommand = async (action) => {
        if (!perms.timer) return alert("Permission Denied");
        
        let cmd = action;
        const isPaused = ipadData.isPaused;
        const activeWorkers = ipadData.activeWorkers || [];

        // FINISH Logic
        if (action === 'FINISH') {
            if (!window.confirm("Are you sure you want to FINISH this project?")) return;
            try {
                // Dashboard no longer writes the report. iPad handles it.
            } catch(e) { 
                console.error(e); 
                alert("Error saving report."); 
                return; 
            }
        } else if (action === 'RESET' || action === 'SAVE') {
            if(!window.confirm(`Are you sure you want to ${action}?`)) return;
        }

        await updateDoc(doc(db, "ipads", id), {
            remoteCommand: cmd,
            commandTimestamp: serverTimestamp()
        });
    };

    const handleClockOut = async (cardId) => {
        if (!perms.timer || !window.confirm(`Clock out worker?`)) return;
        await updateDoc(doc(db, "ipads", id), {
            remoteCommand: `CLOCK_OUT|${cardId}`,
            commandTimestamp: serverTimestamp()
        });
    };

    const updateLeader = async () => {
        if (!newLeaderId) return;
        const name = workersMap[newLeaderId] || `Unknown (${newLeaderId})`;
        if(window.confirm(`Set Leader to ${name}?`)) {
            await updateDoc(doc(db, "ipads", id), { lineLeaderName: name });
            setLeaderEditMode(false);
            setNewLeaderId('');
        }
    };

    const handleDeleteDevice = async () => {
        if (perms.fleet && window.confirm("Delete this device configuration permanently?")) {
            await deleteDoc(doc(db, "ipads", id));
            navigate('/');
        }
    };

    // --- SETUP ACTIONS ---

    const initFromQueue = async () => {
        if (!selectedQueueIdx) return alert("Select a job");
        const job = projectQueue[selectedQueueIdx];
        
        const timeBudget = job.originalSeconds || job.seconds || 0;
        const timeRemaining = job.seconds || timeBudget;

        const payload = {
            companyName: job.company || "Unknown",
            projectName: job.project || "Untitled",
            lineLeaderName: job.lineLeaderName || "",
            category: job.category || "",
            projectSize: job.size || "",
            originalSeconds: timeBudget, 
            remoteCommand: `PRELOAD|0:0:${timeRemaining}`,
            commandTimestamp: serverTimestamp(),
            scanHistory: job.scanHistory || [],
            projectEvents: job.projectEvents || [],
            // Pass pricing info to iPad for reporting
            pricePerUnit: job.pricePerUnit || 0,
            expectedUnits: job.expectedUnits || 0
        };

        await updateDoc(doc(db, "ipads", id), payload);
        await deleteDoc(doc(db, "project_queue", job.id));
        alert("Project Loaded!");
        setActiveTab('live');
    };

    const initManual = async () => {
        const { company, project, category, size, h, m, s } = manualForm;
        if (!company || !project || !category || !size) return alert("Fill all fields");
        
        const totalSec = (parseInt(h||0)*3600) + (parseInt(m||0)*60) + parseInt(s||0);
        if (totalSec <= 0) return alert("Set time");

        const payload = {
            companyName: company,
            projectName: project,
            lineLeaderName: "",
            category: category,
            projectSize: size,
            originalSeconds: totalSec,
            remoteCommand: `PRELOAD|${h}:${m}:${s}`,
            commandTimestamp: serverTimestamp(),
            scanHistory: [],
            projectEvents: [],
            pricePerUnit: 0,
            expectedUnits: 0
        };

        await updateDoc(doc(db, "ipads", id), payload);
        alert("Project Initialized!");
        setActiveTab('live');
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Controller...</div>;

const isActive = !!ipadData?.projectName && ipadData?.projectName !== "No Project Loaded";
const activeWorkers = ipadData?.activeWorkers || [];

    return (
        <div className="ipc-wrapper">
            <div className="ipc-top-bar">
                <button onClick={() => navigate('/')} style={{background:'none', border:'none', fontSize:'16px', cursor:'pointer'}}>
                    &larr; Back to Dashboard
                </button>
                <h1 style={{margin:0, fontSize:'20px'}}>iPad: {id}</h1>
                <button onClick={handleLogout} style={{color:'#e74c3c', background:'none', border:'none', fontWeight:'bold', cursor:'pointer'}}>Sign Out</button>
            </div>

            <div className="ipc-container">
                <div className="ipc-tabs">
                    <button className={`ipc-tab-btn ${activeTab==='live'?'active':''}`} onClick={() => setActiveTab('live')}>Live Controls</button>
                    <button className={`ipc-tab-btn ${activeTab==='data'?'active':''}`} onClick={() => setActiveTab('data')}>Data Logs</button>
                    {perms.settings && (
                        <button className={`ipc-tab-btn ${activeTab==='app'?'active':''}`} onClick={() => setActiveTab('app')}>App Settings</button>
                    )}
                </div>

                {/* --- TAB: LIVE --- */}
                {activeTab === 'live' && (
                    <div style={{display: 'grid', gridTemplateColumns: '2fr 3fr', gap: '25px'}}>
                        <div className="ipc-card">
                            <div style={{fontSize:'16px', fontWeight:'bold', marginBottom:'15px', color:'#95a5a6', textTransform:'uppercase'}}>Current Job</div>
                            
                            <div className="ipc-live-info-box">
                                <div className="ipc-live-meta">{ipadData.companyName || "--"}</div>
                                <div className="ipc-live-project">{ipadData.projectName || "No Project Loaded"}</div>
                                
                                <div style={{marginTop:'5px'}}>
                                    {leaderEditMode ? (
                                        <div>
                                            <input 
                                                value={newLeaderId} 
                                                onChange={e => setNewLeaderId(e.target.value)} 
                                                placeholder="Card ID #"
                                                style={{width:'140px', padding:'6px', borderRadius:'4px', border:'1px solid #ddd'}}
                                            />
                                            <button className="ipc-btn-small-green" onClick={updateLeader}>SAVE</button>
                                            <span className="material-icons" onClick={() => setLeaderEditMode(false)} style={{cursor:'pointer', color:'#e74c3c', verticalAlign:'middle', marginLeft:'5px'}}>close</span>
                                        </div>
                                    ) : (
                                        <div>
                                            <span className="ipc-live-leader">{ipadData.lineLeaderName ? `Leader: ${ipadData.lineLeaderName}` : "No Leader"}</span>
                                            <span className="material-icons leader-edit-icon" onClick={() => setLeaderEditMode(true)}>edit</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="ipc-timer-display">{displayTime}</div>

                            <div className={`ipc-control-grid ${!perms.timer ? 'disabled-overlay' : ''}`}>
                                {/* ROW 1: Standard Controls */}
                                <button className={`ipc-ctrl-btn ${ipadData.isPaused ? 'btn-paused' : 'btn-run'}`} onClick={() => sendCommand('TOGGLE')}>
                                    {ipadData.isPaused ? 'RESUME' : 'PAUSE'}
                                </button>
                                <button className="ipc-ctrl-btn btn-lunch" onClick={() => sendCommand('LUNCH')}>LUNCH</button>
                                <button className="ipc-ctrl-btn btn-save" onClick={() => sendCommand('SAVE')}>SAVE</button>
                                <button className="ipc-ctrl-btn btn-reset" onClick={() => sendCommand('RESET')}>RESET</button>

                                {/* ROW 2: PROCEDURES */}
                                <button 
                                    className="ipc-ctrl-btn" 
                                    style={{background:'#8e44ad', color:'white', fontSize:'11px', fontWeight:'bold'}}
                                    onClick={() => {
                                        if(window.confirm("QC PAUSE (CREW)?\n\n⚠️ This will CANCEL the bonus.")) sendCommand('QC_PAUSE_CREW');
                                    }}
                                >
                                    QC: CREW
                                </button>

                                <button 
                                    className="ipc-ctrl-btn" 
                                    style={{background:'#9b59b6', color:'white', fontSize:'11px', fontWeight:'bold'}}
                                    onClick={() => sendCommand('QC_PAUSE_COMP')}
                                >
                                    QC: COMP
                                </button>

                                <button 
                                    className="ipc-ctrl-btn" 
                                    style={{background:'#f39c12', color:'white', fontSize:'11px', fontWeight:'bold'}}
                                    onClick={() => sendCommand('TECH_PAUSE')}
                                >
                                    TECH ISSUE
                                </button>

                                <button 
                                    className="ipc-ctrl-btn" 
                                    style={{background:'#e74c3c', color:'white', fontSize:'11px', fontWeight:'bold'}} 
                                    onClick={() => {
                                        if(window.confirm("Are you sure you want to DISQUALIFY this project from the bonus?")) {
                                            sendCommand('CANCEL_BONUS');
                                        }
                                    }}
                                >
                                    NO BONUS
                                </button>

                                {/* ROW 3: Finish */}
                                <button className="ipc-ctrl-btn btn-finish" style={{gridColumn:'span 2'}} onClick={() => sendCommand('FINISH')}>FINISH</button>
                            </div>
                        </div>

                        <div className="ipc-card">
                            <div style={{fontSize:'16px', fontWeight:'bold', marginBottom:'25px'}}>
                                Active Personnel <span style={{background:'#3498db', color:'white', fontSize:'12px', padding:'2px 8px', borderRadius:'10px'}}>{activeWorkers.length}</span>
                            </div>
                            <table className="ipc-table">
                                <thead>
                                    <tr><th>Name</th><th>Logged Time</th><th style={{textAlign:'right'}}>Action</th></tr>
                                </thead>
                                <tbody>
                                    {activeWorkers.length === 0 ? (
                                        <tr><td colSpan="3" style={{textAlign:'center', color:'#999'}}>None</td></tr>
                                    ) : (
                                        activeWorkers.map(wid => {
                                            const timeData = getWorkerTimeData(wid);
                                            const isEditing = editingWorker && editingWorker.id === wid;
                                            return (
                                                <tr key={wid}>
                                                    <td>
                                                        <div style={{fontWeight:'bold'}}>{workersMap[wid] || wid}</div>
                                                        <div style={{fontSize:'11px', color:'#7f8c8d'}}>{wid}</div>
                                                    </td>
                                                    <td style={{fontWeight:'bold', color:'#2c3e50'}}>
                                                        {isEditing ? (
                                                            <div style={{display:'flex', alignItems:'center', gap:'5px'}}>
                                                                <input type="number" value={editingWorker.h} onChange={e=>setEditingWorker({...editingWorker, h:e.target.value})} style={{width:'40px', padding:'4px', borderRadius:'4px', border:'1px solid #ccc'}} /> h
                                                                <input type="number" value={editingWorker.m} onChange={e=>setEditingWorker({...editingWorker, m:e.target.value})} style={{width:'40px', padding:'4px', borderRadius:'4px', border:'1px solid #ccc'}} /> m
                                                            </div>
                                                        ) : (
                                                            formatWorkerTime(timeData.totalMinutes)
                                                        )}
                                                    </td>
                                                    <td style={{textAlign:'right'}}>
                                                        {isEditing ? (
                                                            <div style={{display:'flex', justifyContent:'flex-end', gap:'5px'}}>
                                                                <button className="ipc-btn-small-green" onClick={saveWorkerTime} style={{background:'#27ae60', color:'white', border:'none', padding:'4px 8px', borderRadius:'4px', cursor:'pointer'}}>Save</button>
                                                                <button style={{background:'#e74c3c', color:'white', border:'none', padding:'4px 8px', borderRadius:'4px', cursor:'pointer'}} onClick={()=>setEditingWorker(null)}>X</button>
                                                            </div>
                                                        ) : (
                                                            <div style={{display:'flex', justifyContent:'flex-end', gap:'8px'}}>
                                                                <button className="btn-small-blue" onClick={() => startEditingWorker(wid)} style={{background:'#3498db', color:'white', border:'none', padding:'4px 8px', borderRadius:'4px', cursor:'pointer'}}>Edit</button>
                                                                <button className="btn-small-red" onClick={() => handleClockOut(wid)} style={{background:'#e74c3c', color:'white', border:'none', padding:'4px 8px', borderRadius:'4px', cursor:'pointer'}}>Out</button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* --- TAB: DATA LOGS --- */}
                {activeTab === 'data' && (
                    <div className="ipc-card">
                        <div style={{fontSize:'18px', fontWeight:'bold', marginBottom:'10px'}}>Project Activity Logs</div>
                        
                        <div className="ipc-log-section">Events (Pause/Lunch)</div>
                        <table className="ipc-table">
                            <thead><tr><th>Time</th><th>Event Type</th></tr></thead>
                            <tbody>
                                {(ipadData.projectEvents || []).length === 0 && <tr><td colSpan="2" style={{color:'#999'}}>No events</td></tr>}
                                {[...(ipadData.projectEvents || [])].sort((a,b) => (b.timestamp?.seconds||0)-(a.timestamp?.seconds||0)).map((e, i) => (
                                    <tr key={i}>
                                        <td className="log-timestamp">{e.timestamp?.seconds ? new Date(e.timestamp.seconds*1000).toLocaleTimeString() : '-'}</td>
                                        <td>{e.type}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div className="ipc-log-section">Scan History</div>
                        <table className="ipc-table">
                            <thead><tr><th>Time</th><th>Worker</th><th>Action</th></tr></thead>
                            <tbody>
                                {(ipadData.scanHistory || []).length === 0 && <tr><td colSpan="3" style={{color:'#999'}}>No scans</td></tr>}
                                {[...(ipadData.scanHistory || [])].sort((a,b) => (b.timestamp?.seconds||0)-(a.timestamp?.seconds||0)).map((s, i) => (
                                    <tr key={i}>
                                        <td className="log-timestamp">{s.timestamp?.seconds ? new Date(s.timestamp.seconds*1000).toLocaleTimeString() : '-'}</td>
                                        <td>{workersMap[s.cardID] || s.cardID}</td>
                                        <td>
                                            <span className={s.action.includes('In') ? 'log-badge-in' : 'log-badge-out'}>{s.action}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* --- TAB: APP SETTINGS --- */}
                {activeTab === 'app' && (
                    <div>
                        <div className={`ipc-card ${!perms.settings ? 'disabled-overlay' : ''}`}>
                            <div style={{fontSize:'18px', fontWeight:'bold', marginBottom:'20px', borderBottom:'1px solid #eee', paddingBottom:'10px'}}>Project Configuration</div>
                            
                            {isActive && (
                                <div className="locked-msg">
                                    <span className="material-icons" style={{fontSize:'16px', verticalAlign:'middle', marginRight:'5px'}}>lock</span> 
                                    Project is Active. Settings are locked. Reset timer to edit.
                                </div>
                            )}

                            <div className={isActive ? 'disabled-overlay' : ''}>
                                {setupMode === 'queue' ? (
                                    <div>
                                        <div style={{marginBottom:'20px'}}>
                                            <label style={{color:'#16a085', fontSize:'14px', fontWeight:'bold'}}>1. Select Upcoming Project</label>
                                            <select 
                                                style={{width:'100%', padding:'12px', fontWeight:'bold', borderRadius:'6px', border:'2px solid #16a085', fontSize:'16px', marginTop:'10px'}}
                                                value={selectedQueueIdx}
                                                onChange={(e) => setSelectedQueueIdx(e.target.value)}
                                            >
                                                <option value="">-- Choose a Job --</option>
                                                {projectQueue.map((job, idx) => (
                                                    <option key={job.id} value={idx}>{job.project} ({job.company}) - {job.size}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <button className="ipc-save-btn" style={{background:'#16a085'}} onClick={initFromQueue}>Send to iPad & Initialize</button>
                                        <div style={{marginTop:'20px', textAlign:'center'}}>
                                            <span style={{fontSize:'12px', color:'#999'}}>OR</span><br/>
                                            <button style={{background:'none', border:'none', color:'#e74c3c', fontWeight:'bold', cursor:'pointer', marginTop:'10px'}} onClick={() => setSetupMode('manual')}>Switch to Manual Setup</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="ipc-form-grid">
                                            <div>
                                                <label className="ipc-label">Company</label>
                                                <select className="ipc-select" value={manualForm.company} onChange={e => setManualForm({...manualForm, company: e.target.value})}>
                                                    <option value="">Select...</option>
                                                    {dropdowns.companies.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="ipc-label">Project Name</label>
                                                <input className="ipc-input" value={manualForm.project} onChange={e => setManualForm({...manualForm, project: e.target.value})} placeholder="Project Name" />
                                            </div>
                                            <div>
                                                <label className="ipc-label">Category</label>
                                                <select className="ipc-select" value={manualForm.category} onChange={e => setManualForm({...manualForm, category: e.target.value})}>
                                                    <option value="">Select...</option>
                                                    {dropdowns.categories.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="ipc-label">Project Size</label>
                                                <select className="ipc-select" value={manualForm.size} onChange={e => setManualForm({...manualForm, size: e.target.value})}>
                                                    <option value="">Select...</option>
                                                    {dropdowns.sizes.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        <br/>

                                        <div className="ipc-time-set-box">
                                            <label style={{fontWeight:'bold', fontSize:'14px', color:'#2c3e50'}}>SET TIME ALLOCATION</label>
                                            <div className="ipc-time-inputs">
                                                <input type="number" className="ipc-time-input" placeholder="00" value={manualForm.h} onChange={e => setManualForm({...manualForm, h: e.target.value})} /> <span>:</span>
                                                <input type="number" className="ipc-time-input" placeholder="00" value={manualForm.m} onChange={e => setManualForm({...manualForm, m: e.target.value})} /> <span>:</span>
                                                <input type="number" className="ipc-time-input" placeholder="00" value={manualForm.s} onChange={e => setManualForm({...manualForm, s: e.target.value})} />
                                            </div>
                                        </div>

                                        <button className="ipc-save-btn" onClick={initManual}>Initialize Manually</button>
                                        <div style={{marginTop:'20px', textAlign:'center'}}>
                                            <button style={{background:'none', border:'none', color:'#e74c3c', fontWeight:'bold', cursor:'pointer'}} onClick={() => setSetupMode('queue')}>Cancel & Return to Queue</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {perms.fleet && (
                            <div style={{marginTop:'20px'}}>
                                <button style={{background:'transparent', color:'#e74c3c', border:'1px solid #e74c3c', padding:'8px 15px', borderRadius:'6px', cursor:'pointer'}} onClick={handleDeleteDevice}>
                                    Delete Device
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default IPad;