import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './FinanceInput.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, orderBy, limit, getDocs, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

// --- CHILD COMPONENT: FINANCE CARD ---
const FinanceCard = ({ data, agents, canEdit, onRefresh }) => {
    // Basic Fields
    const [financeDesc, setFinanceDesc] = useState(data.financeDesc || `${data.project} - ${data.size}`);
    const [totalUnits, setTotalUnits] = useState(data.totalUnits || '');
    const [invoiceAmount, setInvoiceAmount] = useState(data.invoiceAmount || '');
    const [agentName, setAgentName] = useState(data.agentName || '');
    const [commissionExcluded, setCommissionExcluded] = useState(data.commissionExcluded || '');

    // Adjustment Logic
    const [isAdjusting, setIsAdjusting] = useState(data.laborAdjustmentActive || false);
    const [adjustOp, setAdjustOp] = useState(data.laborAdjustmentType || 'add');
    const [adjustMethod, setAdjustMethod] = useState(data.laborCalculationMethod || 'total');
    
    // Manual Hours
    const [manTotal, setManTotal] = useState(data.manualTotalHours || '');
    const [manPpl, setManPpl] = useState(data.manualPeople || '');
    const [manAvg, setManAvg] = useState(data.manualAvgHours || '');

    // Helper: Scanned Time
    const scannedSecs = (data.originalSeconds || 0) - (data.finalSeconds || 0);
    const scannedHrs = (scannedSecs / 3600).toFixed(2);
    const dateStr = data.completedAt ? new Date(data.completedAt.seconds * 1000).toLocaleString() : 'Unknown';

    // Toggle Commission Field visibility logic
    useEffect(() => {
        if (!agentName) setCommissionExcluded('');
    }, [agentName]);

    const handleDelete = async () => {
        if(!window.confirm("PERMANENTLY DELETE report?")) return;
        try {
            await deleteDoc(doc(db, "reports", data.id));
            onRefresh();
        } catch(e) { alert("Error: " + e.message); }
    };

    const handleProcess = async () => {
        if(!totalUnits || !invoiceAmount) return alert("Please enter Total Units and Invoice Amount.");

        let updates = {
            financeDesc,
            totalUnits: Number(totalUnits),
            invoiceAmount: Number(invoiceAmount),
            agentName,
            commissionExcluded: Number(commissionExcluded) || 0,
            financeStatus: "complete", // Moves to Bonuses
            laborAdjustmentActive: isAdjusting
        };

        // --- TIME CALCULATION ---
        let finalSecondsResult = scannedSecs; 

        if (isAdjusting) {
            updates.laborAdjustmentType = adjustOp;
            updates.laborCalculationMethod = adjustMethod;

            let adjustHours = 0;
            if (adjustMethod === 'total') {
                if (!manTotal || manTotal < 0) return alert("Enter valid Total Hours");
                adjustHours = parseFloat(manTotal);
                updates.manualTotalHours = adjustHours;
            } else {
                if (!manPpl || !manAvg) return alert("Enter People and Hours");
                adjustHours = parseFloat(manPpl) * parseFloat(manAvg);
                updates.manualPeople = parseFloat(manPpl);
                updates.manualAvgHours = parseFloat(manAvg);
                updates.manualTotalHours = adjustHours;
            }

            const adjustSeconds = adjustHours * 3600;
            if (adjustOp === 'add') finalSecondsResult += adjustSeconds;
            else {
                finalSecondsResult -= adjustSeconds;
                if(finalSecondsResult < 0) finalSecondsResult = 0;
            }
        } else {
            updates.manualTotalHours = 0;
        }

        updates.originalSeconds = finalSecondsResult;
        updates.finalSeconds = 0;

        if(window.confirm("Finalize this report? It will move to the Financial Report.")) {
            try {
                await updateDoc(doc(db, "reports", data.id), updates);
                onRefresh();
            } catch(e) { alert("Error: " + e.message); }
        }
    };

    return (
        <div className="fi-task-card">
            <div className="fi-task-header">
                <div>
                    <div className="fi-project-title">{data.project}</div>
                    <div className="fi-project-meta">{data.company} • {data.size}</div>
                </div>
                <div className="fi-time-badge">{dateStr}</div>
            </div>

            {data.bonusEligible === false && (
                <div className="fi-bonus-warning">
                    <span className="material-icons">warning</span>
                    <div>
                        <strong>BONUS INELIGIBLE</strong><br/>
                        <span style={{fontSize:'13px'}}>Reason: {data.bonusIneligibleReason || 'No reason provided'}</span>
                    </div>
                </div>
            )}

            <div className="fi-input-grid">
                <div><label className="fi-label">Packing List #</label><input className="fi-input" value={data.plNumber || '-'} disabled /></div>
                <div><label className="fi-label">Project Type</label><input className="fi-input" value={data.projectType || '-'} disabled /></div>
                <div><label className="fi-label">Description (Editable)</label><input className="fi-input" value={financeDesc} onChange={e => setFinanceDesc(e.target.value)} disabled={!canEdit} /></div>
                
                <div><label className="fi-label">Total Units Produced</label><input type="number" className="fi-input" value={totalUnits} onChange={e => setTotalUnits(e.target.value)} disabled={!canEdit} /></div>
                <div><label className="fi-label">Total Invoice Value ($)</label><input type="number" className="fi-input" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} disabled={!canEdit} /></div>
                
                <div>
                    <label className="fi-label">Commission Agent</label>
                    <select className="fi-select" value={agentName} onChange={e => setAgentName(e.target.value)} disabled={!canEdit}>
                        <option value="">None</option>
                        {agents.map((a, i) => <option key={i} value={a.name}>{a.name} ({a.comm}%)</option>)}
                    </select>
                </div>

                {agentName && (
                    <div>
                        <label className="fi-label" style={{color:'#e67e22'}}>Exclude from Comm ($)</label>
                        <input type="number" className="fi-input" value={commissionExcluded} onChange={e => setCommissionExcluded(e.target.value)} placeholder="e.g. Shipping/Tax" disabled={!canEdit} />
                    </div>
                )}
            </div>

            <div className="fi-adjust-box">
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px'}}>
                    <label className="fi-chk-container">
                        <input type="checkbox" checked={isAdjusting} onChange={e => setIsAdjusting(e.target.checked)} disabled={!canEdit} />
                        <span className="fi-chk-label" style={{color:'#e67e22'}}>Confirm Time Adjustment</span>
                    </label>
                    <span style={{fontSize:'11px', color:'#7f8c8d'}}>Scanned Time: <strong>{scannedHrs} hrs</strong></span>
                </div>

                {isAdjusting ? (
                    <div className="fi-adjust-ui">
                        <div style={{display:'flex', gap:'10px', marginBottom:'10px'}}>
                            <div style={{flex:1}}>
                                <label className="fi-label">Operation</label>
                                <select className="fi-select" value={adjustOp} onChange={e => setAdjustOp(e.target.value)} disabled={!canEdit}>
                                    <option value="add">Add (+)</option>
                                    <option value="sub">Subtract (-)</option>
                                </select>
                            </div>
                            <div style={{flex:1}}>
                                <label className="fi-label">Method</label>
                                <select className="fi-select" value={adjustMethod} onChange={e => setAdjustMethod(e.target.value)} disabled={!canEdit}>
                                    <option value="total">Total Man Hours</option>
                                    <option value="calc">Hours x Men</option>
                                </select>
                            </div>
                        </div>

                        {adjustMethod === 'total' ? (
                            <div>
                                <label className="fi-label">Total Hours to Adjust</label>
                                <input type="number" className="fi-input" value={manTotal} onChange={e => setManTotal(e.target.value)} placeholder="e.g. 2.5" disabled={!canEdit} />
                            </div>
                        ) : (
                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px'}}>
                                <div><label className="fi-label"># People</label><input type="number" className="fi-input" value={manPpl} onChange={e => setManPpl(e.target.value)} placeholder="5" disabled={!canEdit} /></div>
                                <div><label className="fi-label">Hours Each</label><input type="number" className="fi-input" value={manAvg} onChange={e => setManAvg(e.target.value)} placeholder="8" disabled={!canEdit} /></div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{fontSize:'12px', color:'#999', marginLeft:'25px'}}>Using Scan Data Only. No adjustments will be made.</div>
                )}
            </div>

            {/* --- UPDATED FOOTER LAYOUT --- */}
            {canEdit ? (
                <div className="fi-card-footer">
                    <button className="btn btn-red" onClick={handleDelete}>Delete</button>
                    <button className="btn btn-green" onClick={handleProcess}>Finalize & Complete</button>
                </div>
            ) : (
                <div style={{textAlign:'right', color:'#999', fontStyle:'italic', marginTop:'15px'}}>Read Only View</div>
            )}
        </div>
    );
};

// --- MAIN COMPONENT ---
const FinanceInput = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [pendingReports, setPendingReports] = useState([]);
    const [agents, setAgents] = useState([]);
    const [canEdit, setCanEdit] = useState(false);

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
        let view = false;
        let edit = false;

        if (role === 'admin') { view = true; edit = true; }
        else if (rolesSnap.exists()) {
            const rc = rolesSnap.data()[role];
            if (rc) {
                if (rc['finance_view']) view = true;
                if (rc['finance_edit']) edit = true;
            }
        }

        if (view) {
            setCanEdit(edit);
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
            if(cSnap.exists()) setAgents(cSnap.data().agents || []);
        } catch(e) { console.error(e); }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, "reports"), orderBy("completedAt", "desc"), limit(100));
            const snap = await getDocs(q);
            let list = [];
            
            snap.forEach(d => {
                const data = d.data();
                if (data.financeStatus === "pending_finance") {
                    list.push({ id: d.id, ...data });
                }
            });
            setPendingReports(list);
        } catch(e) { console.error(e); }
        setLoading(false);
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading...</div>;

    return (
        <div className="fi-wrapper">
            <div className="fi-top-bar">
                <button onClick={() => navigate('/')} className="btn-back">
                    <span className="material-icons">arrow_back</span> Dashboard
                </button>
                <div style={{fontWeight:'bold', color:'#f1c40f', display:'flex', alignItems:'center', gap:'8px'}}>
                    <span className="material-icons">monetization_on</span> Finance Input
                </div>
                <div onClick={handleLogout} style={{color:'#e74c3c', fontWeight:'bold', cursor:'pointer'}}>Sign Out</div>
            </div>

            <div className="fi-container">
                {pendingReports.length === 0 ? (
                    <div className="fi-empty">
                        <span className="material-icons" style={{fontSize:'48px'}}>paid</span><br/>
                        <h3>No projects waiting.</h3>
                        <p style={{color:'#7f8c8d'}}>Production must submit items first.</p>
                    </div>
                ) : (
                    pendingReports.map(item => (
                        <FinanceCard 
                            key={item.id} 
                            data={item} 
                            agents={agents} 
                            canEdit={canEdit} 
                            onRefresh={fetchData} 
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default FinanceInput;