import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './manual_ingest.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, addDoc, getDocs, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const ManualIngest = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [rawText, setRawText] = useState('');
    const [parsedData, setParsedData] = useState(null);
    const [status, setStatus] = useState({ type: '', msg: '' });
    const [workersMap, setWorkersMap] = useState({});
    
    // Interactive State for Preview
    const [selectedLeader, setSelectedLeader] = useState('');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                loadUserData(user, async () => {
                    await checkAccess(user);
                });
            } else {
                navigate('/');
            }
        });
        return () => unsubscribe();
    }, []);

    const checkAccess = async (user) => {
        const uSnap = await getDoc(doc(db, "users", user.email.toLowerCase()));
        if (!uSnap.exists()) return denyAccess();
        const role = uSnap.data().role;

        const rolesSnap = await getDoc(doc(db, "config", "roles"));
        let allowed = false;
        if (role === 'admin') allowed = true;
        else if (rolesSnap.exists()) {
            const rc = rolesSnap.data()[role];
            if (rc && (rc['admin_edit'] || rc['queue_edit'])) allowed = true;
        }

        if (allowed) {
            await fetchWorkers();
            setLoading(false);
        } else {
            denyAccess();
        }
    };

    const denyAccess = () => {
        alert("Access Denied");
        navigate('/');
    };

    const fetchWorkers = async () => {
        try {
            const snap = await getDocs(collection(db, "workers"));
            const map = {};
            snap.forEach(d => {
                // Map ID to Name, and Name to Name (for lookup)
                const w = d.data();
                const name = w.name || `${w.firstName} ${w.lastName}`;
                if(w.workerId) map[w.workerId] = name; // If you have IDs
                map[name] = name; // Also store names directly
            });
            setWorkersMap(map);
        } catch(e) { console.error("Worker fetch error", e); }
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    // --- PARSING LOGIC ---
    const parseReportText = (input) => {
        let text = input.replace(/\u00A0/g, ' '); 

        const extract = (key) => {
            const regex = new RegExp(`${key}:\\s*(.*)`, 'i');
            const match = text.match(regex);
            return match ? match[1].trim() : null;
        };

        const timeToSec = (str) => {
            if(!str) return 0;
            const parts = str.split(':').map(Number);
            if(parts.length !== 3) return 0;
            return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
        };

        const safeDateParse = (dateStr) => {
            if(!dateStr) return null;
            let clean = dateStr.replace(/ at /i, ' ').trim(); 
            clean = clean.replace(/^\[+|\]+$/g, '');
            let d = new Date(clean);
            return isNaN(d.getTime()) ? null : d;
        };

        // Header Info
        const company = extract('Company Name') || "Unknown";
        const project = extract('Project Name') || "Unknown";
        const leaderRaw = extract('Line Leader') || "";
        const category = extract('Category') || "";
        const size = extract('Project Size') || "";
        const originalSeconds = timeToSec(extract('Time Given'));
        const currentSeconds = timeToSec(extract('Time Remaining'));
        const finalSeconds = currentSeconds; // Logic from HTML

        // Line-by-Line Parsing
        const lines = text.split('\n');
        let workerCalculations = {};
        let allScanIds = new Set();
        let historyMatchCount = 0;
        
        const badIds = [(new Date().getFullYear()).toString(), (new Date().getFullYear()+1).toString()];

        lines.forEach(line => {
            const cleanLine = line.trim();
            if(!cleanLine) return;

            // A. History Logs
            if (cleanLine.includes('Clocked In') || cleanLine.includes('Clocked Out')) {
                const parts = cleanLine.split(']:');
                if (parts.length >= 2) {
                    const timePart = parts[0];
                    const dataPart = parts[1];
                    const dataSplit = dataPart.split('-');
                    
                    if (dataSplit.length >= 2) {
                        const workerId = dataSplit[0].trim();
                        const action = dataSplit[1].trim().toLowerCase();
                        const eventTime = safeDateParse(timePart);

                        if (workerId && eventTime && !badIds.includes(workerId)) {
                            historyMatchCount++;
                            if (!workerCalculations[workerId]) {
                                workerCalculations[workerId] = { startTime: null, totalSeconds: 0 };
                            }

                            if (action.includes('clocked in')) {
                                workerCalculations[workerId].startTime = eventTime;
                            } else if (action.includes('clocked out')) {
                                if (workerCalculations[workerId].startTime) {
                                    const diffMs = eventTime - workerCalculations[workerId].startTime;
                                    const diffSec = diffMs / 1000;
                                    if (diffSec > 0 && diffSec < 86400) {
                                        workerCalculations[workerId].totalSeconds += diffSec;
                                    }
                                    workerCalculations[workerId].startTime = null;
                                }
                            }
                            allScanIds.add(workerId);
                        }
                    }
                }
            }
            
            // B. ID Summaries
            if (/^\d{4,15}$/.test(cleanLine)) {
                if (!badIds.includes(cleanLine)) {
                    allScanIds.add(cleanLine);
                }
            }
        });

        const workerLog = Array.from(allScanIds).map(id => {
            const calc = workerCalculations[id];
            const secs = calc ? calc.totalSeconds : 0;
            const mins = secs > 0 ? (secs / 60) : 0;
            
            // Lookup Name using the map we fetched
            const name = workersMap[id] || `Unknown (${id})`; 
            return { cardId: id, name, minutes: mins };
        });

        const genDateStr = extract('Generated');
        let timestamp = safeDateParse(genDateStr) || new Date();

        return {
            company, project, leader: leaderRaw, category, size,
            originalSeconds, finalSeconds,
            workerCountAtFinish: workerLog.length,
            workerLog,
            completedAt: timestamp,
            financeStatus: "pending_production",
            totalScans: parseInt(extract('Total Scans')) || 0,
            importedVia: 'manual_text_ingest',
            _debugHistoryCount: historyMatchCount
        };
    };

    const handlePreview = () => {
        setStatus({ type: '', msg: '' });
        try {
            const result = parseReportText(rawText);
            setParsedData(result);
            
            // Smart Leader Match
            const raw = (result.leader || '').toLowerCase();
            const allNames = Object.values(workersMap).sort();
            const match = allNames.find(n => n.toLowerCase().includes(raw) && raw.length > 2);
            setSelectedLeader(match || result.leader); // Default to match or raw

        } catch (e) {
            console.error(e);
            setStatus({ type: 'error', msg: "Error Parsing: " + e.message });
            setParsedData(null);
        }
    };

    const handleSubmit = async () => {
        if(!parsedData) return;
        
        const finalData = { ...parsedData, leader: selectedLeader };
        delete finalData._debugHistoryCount; // Clean up

        try {
            await addDoc(collection(db, "reports"), finalData);
            setStatus({ type: 'success', msg: "Success! Report imported. Check 'Production Input'." });
            setParsedData(null);
            setRawText('');
        } catch (e) {
            setStatus({ type: 'error', msg: "Firestore Error: " + e.message });
        }
    };

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading...</div>;

    return (
        <div className="manual-ingest-wrapper">
            <div className="mi-top-bar">
                <button onClick={() => navigate('/')} style={{background:'none', border:'none', fontSize:'16px', fontWeight:'bold', cursor:'pointer', color:'#2c3e50'}}>&larr; Dashboard</button>
                <div style={{fontWeight:'bold'}}>Raw Data Ingest</div>
                <button onClick={handleLogout} className="btn-red-text">Sign Out</button>
            </div>

            <div className="manual-ingest-container">
                <div className="mi-card">
                    <h2 style={{marginTop:0}}>Paste Project Report</h2>
                    <p style={{color:'#7f8c8d', fontSize:'14px'}}>Paste the full text from the "Project Finished Report" below.</p>
                    
                    <textarea 
                        className="mi-textarea" 
                        placeholder="Paste report text here..." 
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                    ></textarea>

                    <button className="btn btn-blue" onClick={handlePreview}>Preview Data</button>

                    {status.msg && (
                        <div className={`status-msg ${status.type === 'error' ? 'status-error' : 'status-success'}`}>
                            {status.msg}
                        </div>
                    )}

                    {parsedData && (
                        <div className="preview-box">
                            <h4 style={{marginTop:0}}>Parsed Data Preview</h4>
                            
                            <div className="preview-row"><span className="preview-label">Company:</span> <span>{parsedData.company}</span></div>
                            <div className="preview-row"><span className="preview-label">Project:</span> <span>{parsedData.project}</span></div>
                            
                            <div className="preview-row">
                                <span className="preview-label" style={{color:'#3498db'}}>Line Leader:</span> 
                                <select 
                                    className="mi-select" 
                                    value={selectedLeader} 
                                    onChange={(e) => setSelectedLeader(e.target.value)}
                                >
                                    <option value={parsedData.leader}>{parsedData.leader} (Raw)</option>
                                    {Object.values(workersMap).sort().map((name, i) => (
                                        <option key={i} value={name}>{name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="preview-row"><span className="preview-label">Labor Hours:</span> <span>{((parsedData.originalSeconds - parsedData.finalSeconds)/3600).toFixed(2)} hrs</span></div>
                            <div className="preview-row"><span className="preview-label">Workers Found:</span> <span>{parsedData.workerLog.length}</span></div>

                            <div className="worker-list-box">
                                <div className="preview-label" style={{marginBottom:'5px', borderBottom:'1px solid #eee'}}>Calculated Worker Times:</div>
                                {parsedData.workerLog.sort((a,b) => b.minutes - a.minutes).map((w, i) => (
                                    <div key={i} className="worker-time-row" style={{color: w.minutes===0 ? '#e74c3c' : 'inherit'}}>
                                        <span>{w.name}</span>
                                        <span>{w.minutes===0 && '(0 min) '} <b>{w.minutes.toFixed(2)} mins</b></span>
                                    </div>
                                ))}
                            </div>

                            <div className="debug-info">
                                Debug: Found {parsedData._debugHistoryCount} history events.
                            </div>

                            <button className="btn btn-green" onClick={handleSubmit}>Confirm & Import</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManualIngest;