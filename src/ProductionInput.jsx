import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './ProductionInput.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, orderBy, limit, getDocs, doc, getDoc, updateDoc, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

// --- SUB-COMPONENT: Individual Report Card ---
const ReportCard = ({ data, projectTypes, onRefresh }) => {
    // Initial State setup
    const [plNumber, setPlNumber] = useState(data.plNumber ? data.plNumber.replace(/^(PL-|PL)/i, '').trim() : '');
    const [projectType, setProjectType] = useState(data.projectType || '');
    
    // BONUS LOGIC: Defaults to True (Eligible) unless explicitly False
    const [isBonusEligible, setIsBonusEligible] = useState(data.bonusEligible !== false); 
    const [bonusReason, setBonusReason] = useState(data.bonusIneligibleReason || '');
    
    const [isAdjusting, setIsAdjusting] = useState(data.laborAdjustmentActive || false);
    
    // Adjustment States
    const [adjustOp, setAdjustOp] = useState('add');
    const [adjustMethod, setAdjustMethod] = useState('total');
    const [valTotal, setValTotal] = useState('');
    const [valPpl, setValPpl] = useState('');
    const [valAvg, setValAvg] = useState('');

    const scannedSecs = (data.originalSeconds || 0) - (data.finalSeconds || 0);
    const scannedHrs = (scannedSecs / 3600).toFixed(2);
    const dateStr = data.completedAt ? new Date(data.completedAt.seconds * 1000).toLocaleString() : 'Unknown';

    const handleDelete = async () => {
        if(!window.confirm("PERMANENTLY DELETE report? This cannot be undone.")) return;
        try {
            await deleteDoc(doc(db, "reports", data.id));
            onRefresh();
        } catch(e) { alert("Error: " + e.message); }
    };

    const handleReturnQueue = async () => {
        if(!window.confirm("Send back to iPad? This restores remaining time.")) return;
        try {
            // Create queue entry
            await addDoc(collection(db, "project_queue"), {
                company: data.company || "Unknown",
                project: data.project || "Unknown",
                category: data.category || "General",
                size: data.size || "Standard",
                seconds: data.finalSeconds || 0, // Restore remaining
                originalSeconds: data.originalSeconds || 0,
                lineLeaderName: data.leader || "", // Trigger auto-login
                expectedUnits: 0, pricePerUnit: 0,
                requeuedFromReport: true,
                createdAt: serverTimestamp()
            });
            // Delete report
            await deleteDoc(doc(db, "reports", data.id));
            onRefresh();
        } catch(e) { alert("Error: " + e.message); }
    };

    const handleSubmit = async () => {
        // 1. Basic Validation
        if(!plNumber || !projectType) return alert("Please enter PL# and Production Type.");
        
        // 2. Bonus Validation: If NOT eligible, reason is mandatory
        if(!isBonusEligible && !bonusReason.trim()) {
            return alert("Please enter a reason for bonus ineligibility.");
        }

        let updates = {
            plNumber: plNumber,
            projectType: projectType,
            financeStatus: "pending_finance",
            laborAdjustmentActive: isAdjusting,
            
            // 3. Save Bonus Data
            bonusEligible: isBonusEligible,
            bonusIneligibleReason: isBonusEligible ? "" : bonusReason
        };

        if (isAdjusting) {
            updates.laborAdjustmentType = adjustOp;
            updates.laborCalculationMethod = adjustMethod;
            
            if (adjustMethod === 'total') {
                if (!valTotal) return alert("Enter Total Hours");
                updates.manualTotalHours = parseFloat(valTotal);
            } else {
                if (!valPpl || !valAvg) return alert("Enter People and Hours");
                updates.manualPeople = parseFloat(valPpl);
                updates.manualAvgHours = parseFloat(valAvg);
                updates.manualTotalHours = (parseFloat(valPpl) * parseFloat(valAvg));
            }
        } else {
            updates.manualTotalHours = 0;
        }

        if(window.confirm("Confirm details? Sending to Finance.")) {
            try {
                await updateDoc(doc(db, "reports", data.id), updates);
                onRefresh();
            } catch(e) { alert("Error: " + e.message); }
        }
    };

    return (
        <div className="pi-task-card">
            <div className="pi-task-header">
                <div>
                    <div className="pi-project-title">{data.project}</div>
                    <div className="pi-project-meta">{data.company} • Leader: {data.leader || 'Unknown'}</div>
                </div>
                <div className="pi-time-badge">{dateStr}</div>
            </div>

            <div className="pi-input-grid">
                <div>
                    <label className="pi-label">Packing List # (PL)</label>
                    <div className="pi-pl-group">
                        <span className="pi-pl-prefix">PL-</span>
                        <input className="pi-pl-input" value={plNumber} onChange={e => setPlNumber(e.target.value)} placeholder="5505" />
                    </div>
                </div>
                <div>
                    <label className="pi-label">Production Type</label>
                    <select className="pi-select" value={projectType} onChange={e => setProjectType(e.target.value)}>
                        <option value="">Select Type...</option>
                        {projectTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
            </div>

            {/* --- BONUS SECTION (Matching HTML Logic) --- */}
            <div className="pi-bonus-box">
                <label className="pi-chk-container">
                    <input 
                        type="checkbox" 
                        checked={isBonusEligible} 
                        onChange={e => setIsBonusEligible(e.target.checked)} 
                    />
                    <span className="pi-chk-label">Project Eligible for Bonus?</span>
                </label>
                
                {/* Reason box shows only if NOT eligible */}
                {!isBonusEligible && (
                    <div className="pi-reason-box">
                        <label className="pi-label" style={{color:'#c0392b'}}>Reason for Ineligibility *</label>
                        <input 
                            className="pi-input" 
                            value={bonusReason} 
                            onChange={e => setBonusReason(e.target.value)} 
                            placeholder="e.g. Rework Required, Late Shipment, Quality Issue" 
                        />
                    </div>
                )}
            </div>

            <div className="pi-adjust-box">
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px'}}>
                    <label className="pi-chk-container">
                        <input type="checkbox" checked={isAdjusting} onChange={e => setIsAdjusting(e.target.checked)} />
                        <span className="pi-chk-label">Adjust Labor Time</span>
                    </label>
                    <span style={{fontSize:'11px', color:'#7f8c8d'}}>Scanned: <strong>{scannedHrs} hrs</strong></span>
                </div>

                {isAdjusting && (
                    <div className="pi-adjust-ui">
                        <div style={{display:'flex', gap:'10px', marginBottom:'10px'}}>
                            <div style={{flex:1}}>
                                <label className="pi-label">Operation</label>
                                <select className="pi-select" value={adjustOp} onChange={e => setAdjustOp(e.target.value)}>
                                    <option value="add">Add (+)</option>
                                    <option value="sub">Subtract (-)</option>
                                </select>
                            </div>
                            <div style={{flex:1}}>
                                <label className="pi-label">Method</label>
                                <select className="pi-select" value={adjustMethod} onChange={e => setAdjustMethod(e.target.value)}>
                                    <option value="total">Total Man Hours</option>
                                    <option value="calc">Hours x Men</option>
                                </select>
                            </div>
                        </div>

                        {adjustMethod === 'total' ? (
                            <div>
                                <label className="pi-label">Total Hours to Adjust</label>
                                <input type="number" className="pi-input" value={valTotal} onChange={e => setValTotal(e.target.value)} placeholder="e.g. 2.5" />
                            </div>
                        ) : (
                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px'}}>
                                <div><label className="pi-label"># People</label><input type="number" className="pi-input" value={valPpl} onChange={e => setValPpl(e.target.value)} /></div>
                                <div><label className="pi-label">Hours Each</label><input type="number" className="pi-input" value={valAvg} onChange={e => setValAvg(e.target.value)} /></div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="pi-card-footer">
                <div className="pi-action-group">
                    <button className="btn-text btn-red-text" onClick={handleDelete}>
                        <span className="material-icons" style={{fontSize:'16px'}}>delete</span> Delete
                    </button>
                    <button className="btn-text btn-orange-text" onClick={handleReturnQueue}>
                        <span className="material-icons" style={{fontSize:'16px'}}>undo</span> Send to Queue
                    </button>
                </div>
                <button className="btn btn-blue" onClick={handleSubmit}>Submit to Finance &rarr;</button>
            </div>
        </div>
    );
};

// --- MAIN COMPONENT ---
const ProductionInput = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [reports, setReports] = useState([]);
    const [projectTypes, setProjectTypes] = useState([]);
    const [scannedCount, setScannedCount] = useState(0);

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
            if (rc && (rc['queue_edit'] || rc['admin_edit'])) allowed = true;
        }

        if (allowed) {
            await loadConfig();
            fetchData();
        } else {
            denyAccess();
        }
    };

    const denyAccess = () => {
        alert("Access Denied");
        navigate('/');
    };

    const loadConfig = async () => {
        try {
            const cSnap = await getDoc(doc(db, "config", "finance"));
            if(cSnap.exists()) setProjectTypes(cSnap.data().projectTypes || []);
        } catch(e) { console.error(e); }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, "reports"), orderBy("completedAt", "desc"), limit(100));
            const snap = await getDocs(q);
            let pending = [];
            let total = 0;

            snap.forEach(d => {
                total++;
                const data = d.data();
                if (!data.financeStatus || data.financeStatus === "pending_production") {
                    pending.push({ id: d.id, ...data });
                }
            });
            
            setReports(pending);
            setScannedCount(total);
        } catch(e) { console.error(e); }
        setLoading(false);
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Projects...</div>;

    return (
        <div className="pi-wrapper">
            <div className="pi-top-bar">
                <button onClick={() => navigate('/')} style={{background:'none', border:'none', fontSize:'16px', fontWeight:'bold', cursor:'pointer', color:'#2c3e50', display:'flex', alignItems:'center', gap:'5px'}}>
                    <span className="material-icons">arrow_back</span> Dashboard
                </button>
                <div style={{fontWeight:'bold', color:'#3498db', display:'flex', alignItems:'center', gap:'8px'}}>
                    <span className="material-icons">input</span> Production Input
                </div>
                <button onClick={handleLogout} className="btn-text btn-red-text">Sign Out</button>
            </div>

            <div className="pi-container">
                {reports.length === 0 ? (
                    <div className="pi-empty">
                        <span className="material-icons" style={{fontSize:'48px'}}>check_circle</span>
                        <h3>All caught up!</h3>
                        <p style={{color:'#7f8c8d'}}>No pending production inputs found.</p>
                        <div style={{marginTop:'20px', fontSize:'12px', color:'#aaa'}}>Scanned {scannedCount} recent reports.</div>
                    </div>
                ) : (
                    <>
                        {reports.map(r => (
                            <ReportCard 
                                key={r.id} 
                                data={r} 
                                projectTypes={projectTypes} 
                                onRefresh={fetchData} 
                            />
                        ))}
                        <div style={{textAlign:'center', marginTop:'20px', fontSize:'12px', color:'#aaa'}}>
                            Showing {reports.length} of {scannedCount} scanned items
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ProductionInput;