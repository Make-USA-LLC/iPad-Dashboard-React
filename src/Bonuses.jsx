import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Bonuses.css';
import { calculateBonuses, sanitize } from './calculations/bonuses';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const Bonuses = () => {
    const navigate = useNavigate();
    const [view, setView] = useState('unpaid');
    const [reports, setReports] = useState([]);
    const [config, setConfig] = useState({});
    const [processedData, setProcessedData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedRows, setExpandedRows] = useState({});
    const [showSummary, setShowSummary] = useState(true);

    // --- PAY MODAL STATE ---
    const [showPayModal, setShowPayModal] = useState(false);
    const [payDate, setPayDate] = useState('');
    const [payTargetId, setPayTargetId] = useState(null);
    const [payAmount, setPayAmount] = useState(0);

    // --- SETTINGS MODAL STATE ---
    const [showCalcModal, setShowCalcModal] = useState(false);
    const [targetReportId, setTargetReportId] = useState(null);
    const [calcForm, setCalcForm] = useState({
        type: 'standard_percent', distribution: 'hours',
        l_pct: '', w_pct: '', l_fix: '', w_fix: '',
        l_amt: '', l_thr: 1000, w_amt: '', w_thr: 1000
    });

    const [hasAccess, setHasAccess] = useState(false);

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
        if (!uSnap.exists()) return navigate('/');
        const r = uSnap.data().role;

        const rolesSnap = await getDoc(doc(db, "config", "roles"));
        let allowed = false;
        if (r === 'admin') allowed = true;
        else if (rolesSnap.exists()) {
            const rc = rolesSnap.data()[r];
            if (rc && (rc['bonuses_view'] || rc['finance_view'])) allowed = true;
        }

        if (allowed) {
            setHasAccess(true);
            const loadedConfig = await loadConfig();
            loadData(loadedConfig);
        } else {
            alert("Access Denied");
            navigate('/');
        }
    };

    const loadConfig = async () => {
        const cSnap = await getDoc(doc(db, "config", "finance"));
        if(cSnap.exists()) {
            const data = cSnap.data();
            setConfig(data);
            return data;
        }
        return {};
    };

    const loadData = async (currentConfig = config) => {
        setLoading(true);
        const q = query(collection(db, "reports"), where("financeStatus", "==", "complete"));
        const snap = await getDocs(q);
        
        let list = [];
        snap.forEach(d => {
            const data = d.data();
            let include = false;
            if (view === 'ineligible') {
                if (data.bonusEligible === false) include = true;
            } else if (view === 'paid') {
                if (data.bonusPaid === true) include = true;
            } else {
                if (data.bonusEligible !== false && !data.bonusPaid) include = true;
            }
            if (include) list.push({ id: d.id, ...data });
        });

        list.sort((a,b) => (b.completedAt?.seconds||0) - (a.completedAt?.seconds||0));
        setReports(list);

        if (view === 'unpaid') {
            const calcResults = calculateBonuses(list, currentConfig);
            setProcessedData(calcResults);
        }
        setLoading(false);
    };

    useEffect(() => {
        if(hasAccess) loadData(config);
    }, [view]);

    const handleLogout = () => signOut(auth).then(() => window.location.href = '/');
    const toggleRow = (name) => setExpandedRows(prev => ({ ...prev, [name]: !prev[name] }));

    // --- PAY ACTIONS ---
    const clickPay = (reportId, amount) => {
        // Auto-calculate next Wednesday
        const d = new Date();
        const day = d.getDay(); 
        const dist = 6 - day; 
        const nextWed = new Date(d);
        nextWed.setDate(d.getDate() + dist + 4); 
        
        setPayDate(nextWed.toISOString().split('T')[0]); // Format YYYY-MM-DD
        setPayTargetId(reportId);
        setPayAmount(amount);
        setShowPayModal(true);
    };

    const confirmPay = async () => {
        if(!payDate) return alert("Select Date");
        
        const parts = payDate.split('-');
        const fmtDate = `${parts[1]}/${parts[2]}/${parts[0]}`; // MM/DD/YYYY

        const snapshot = {
            costPerHour: parseFloat(config.costPerHour) || 0,
            leaderPoolPercent: parseFloat(config.leaderPoolPercent) || 0,
            workerPoolPercent: parseFloat(config.workerPoolPercent) || 0,
            agents: config.agents || []
        };

        await updateDoc(doc(db, "reports", payTargetId), { 
            bonusPaid: true, 
            finalBonusPaid: payAmount, 
            bonusPaidAt: new Date(), 
            payDate: fmtDate, 
            bonusEligible: true, 
            historicalConfig: snapshot 
        });
        
        setShowPayModal(false);
        loadData(config);
    };

    const handleMarkIneligible = async (reportId) => {
        const r = prompt("Reason for ineligibility:");
        if(!r) return;
        await updateDoc(doc(db, "reports", reportId), { bonusEligible: false, bonusIneligibleReason: r });
        loadData(config);
    };

    const handleEditBonus = async (reportId, personName, currentAmt) => {
        const val = prompt(`Override bonus for ${personName}:`, currentAmt);
        if(val === null) return;
        const num = parseFloat(val);
        if(isNaN(num)) return;

        const ref = doc(db, "reports", reportId);
        const snap = await getDoc(ref);
        let customs = snap.data().customBonuses || {};
        customs[sanitize(personName)] = num;
        await updateDoc(ref, { customBonuses: customs });
        loadData(config);
    };

    // --- CALCULATION MODAL LOGIC ---
    const openCalcModal = (report) => {
        setTargetReportId(report.id);
        const m = report.bonusCalcMethod || {};
        setCalcForm({
            type: m.type || 'standard_percent',
            distribution: m.distribution || 'hours',
            l_pct: m.l_pct || '', w_pct: m.w_pct || '',
            l_fix: m.l_fix || '', w_fix: m.w_fix || '',
            l_amt: m.l_amt || '', l_thr: m.l_thr || 1000,
            w_amt: m.w_amt || '', w_thr: m.w_thr || 1000
        });
        setShowCalcModal(true);
    };

    const saveCalcSettings = async () => {
        const payload = {
            type: calcForm.type,
            distribution: calcForm.distribution,
            ...(calcForm.type.includes('percent') && { l_pct: parseFloat(calcForm.l_pct)||0 }),
            ...(calcForm.type === 'custom_percent' && { w_pct: parseFloat(calcForm.w_pct)||0 }),
            ...(calcForm.type === 'fixed_amount' && { l_fix: parseFloat(calcForm.l_fix)||0, w_fix: parseFloat(calcForm.w_fix)||0 }),
            ...(calcForm.type === 'legacy_interval' && { 
                l_amt: parseFloat(calcForm.l_amt)||0, l_thr: parseFloat(calcForm.l_thr)||1000,
                w_amt: parseFloat(calcForm.w_amt)||0, w_thr: parseFloat(calcForm.w_thr)||1000 
            })
        };
        await updateDoc(doc(db, "reports", targetReportId), { bonusCalcMethod: payload });
        setShowCalcModal(false);
        loadData(config);
    };

    const getCardData = (r) => {
        const result = calculateBonuses([r], config);
        let cardWorkers = [];
        let totalBonus = 0;
        result.forEach(emp => {
            emp.items.forEach(item => {
                cardWorkers.push({
                    name: emp.name, role: item.role, hours: item.hours, amount: item.amount,
                    isCustom: item.isCustom, displayDate: item.originalDate, profit: item.profit, plNumber: item.plNumber
                });
                totalBonus += item.amount;
            });
        });
        return { workers: cardWorkers, totalBonus, profit: cardWorkers[0]?.profit || 0 };
    };

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Bonuses...</div>;
    const grandTotal = processedData.reduce((acc, curr) => acc + curr.total, 0);

    return (
        <div className="bonuses-page-wrapper">
            <div className="bonuses-top-bar">
                <div>
                    <button onClick={() => navigate('/')} style={{border:'none', background:'none', fontWeight:'bold', cursor:'pointer'}}>&larr; Dashboard</button>
                </div>
                
                {/* CENTERED TOGGLE */}
                <div style={{display:'flex', justifyContent:'center'}}>
                    <div className="view-toggle">
                        <button className={`toggle-btn ${view==='unpaid'?'active':''}`} onClick={() => setView('unpaid')}>Pending</button>
                        <button className={`toggle-btn ${view==='paid'?'active paid':''}`} onClick={() => setView('paid')}>History</button>
                        <button className={`toggle-btn ${view==='ineligible'?'active ineligible':''}`} onClick={() => setView('ineligible')}>Ineligible</button>
                    </div>
                </div>

                <div style={{textAlign:'right'}}>
                    <button onClick={handleLogout} style={{color:'#e74c3c', border:'none', background:'none', fontWeight:'bold', cursor:'pointer'}}>Sign Out</button>
                </div>
            </div>

            <div className="bonuses-container">
                {view === 'unpaid' && (
                    <div className="overview-panel">
                        <div className="overview-header" onClick={() => setShowSummary(!showSummary)}>
                            <div style={{display:'flex', alignItems:'center'}}>
                                <span className={`material-icons summary-toggle-icon ${!showSummary ? 'closed' : ''}`}>expand_more</span>
                                <span>Pending Breakdown</span>
                            </div>
                            <span style={{background:'#27ae60', padding:'4px 10px', borderRadius:'12px', fontSize:'14px'}}>
                                ${grandTotal.toLocaleString(undefined, {minimumFractionDigits:2})}
                            </span>
                        </div>

                        {showSummary && processedData.map((emp, idx) => (
                            <div key={idx} className={`worker-summary-row ${expandedRows[emp.name] ? 'open' : ''}`}>
                                <div className="worker-summary-header" onClick={() => toggleRow(emp.name)}>
                                    <div>{emp.name}</div>
                                    <div style={{color: emp.total<0?'#e74c3c':'#27ae60'}}>${emp.total.toFixed(2)}</div>
                                </div>
                                <div className="worker-details">
                                    <table style={{width:'100%', fontSize:'13px', textAlign:'left'}}>
                                        <thead><tr><th>Client</th><th>Date</th><th>Product</th><th>Val</th></tr></thead>
                                        <tbody>
                                            {emp.items.map((j, jx) => (
                                                <tr key={jx}><td>{j.company}</td><td>{j.originalDate}</td><td>{j.project}</td><td>${j.amount.toFixed(2)}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="bonuses-grid">
                    {reports.map(r => {
                        const { workers, totalBonus, profit } = getCardData(r);
                        return (
                            <div key={r.id} className="project-card">
                                <div className="card-header">
                                    <div>
                                        <div className="project-name">{r.project}</div>
                                        <div style={{fontSize:'11px', opacity:0.8}}>{r.company}</div>
                                    </div>
                                    <div style={{textAlign:'right'}}>
                                        <div style={{color:'#f1c40f', fontWeight:'bold'}}>
                                            {r.plNumber ? `PL# ${r.plNumber}` : ''}
                                            {view === 'unpaid' && (
                                                <span className="material-icons settings-icon" onClick={() => openCalcModal(r)}>settings</span>
                                            )}
                                        </div>
                                        <div style={{fontSize:'11px', opacity:0.8}}>{workers[0]?.displayDate}</div>
                                    </div>
                                </div>
                                
                                <div className="profit-section">
                                    <span style={{fontWeight:'bold', color:'#2c3e50'}}>Net Profit</span>
                                    <span className={`profit-val ${profit<0?'neg':'pos'}`}>${profit.toFixed(2)}</span>
                                </div>

                                <div style={{flexGrow:1}}>
                                    <table className="worker-table">
                                        <thead><tr><th>Name</th><th>Time</th><th style={{textAlign:'right'}}>Bonus</th></tr></thead>
                                        <tbody>
                                            {workers.map((w, wx) => (
                                                <tr key={wx}>
                                                    <td>{w.name} <span style={{fontSize:'10px', color:'#999'}}>({w.role})</span></td>
                                                    <td>{w.hours.toFixed(1)}h</td>
                                                    <td style={{textAlign:'right'}}>
                                                        {w.isCustom && <span style={{color:'blue', marginRight:'2px'}}>*</span>}
                                                        ${w.amount.toFixed(2)}
                                                        {view === 'unpaid' && <span className="material-icons" style={{fontSize:'14px', marginLeft:'5px', cursor:'pointer', color:'#999'}} onClick={() => handleEditBonus(r.id, w.name, w.amount)}>edit</span>}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {view === 'unpaid' && (
                                    <div className="card-footer">
                                        <div className="btn-card btn-outline-red" onClick={() => handleMarkIneligible(r.id)}>Block</div>
                                        <div className="btn-card btn-solid-green" onClick={() => clickPay(r.id, totalBonus)}>Pay (${totalBonus.toFixed(2)})</div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* SETTINGS MODAL */}
            {showCalcModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="calc-header">
                            <h3 style={{margin:0}}>Calculation Settings</h3>
                            <span style={{cursor:'pointer'}} onClick={() => setShowCalcModal(false)}>✕</span>
                        </div>
                        <div className="input-group">
                            <label>Method</label>
                            <select value={calcForm.type} onChange={e => setCalcForm({...calcForm, type: e.target.value})}>
                                <option value="standard_percent">Standard (% of Profit)</option>
                                <option value="leader_percent">Leader Only % (Override)</option>
                                <option value="custom_percent">Custom Percentages</option>
                                <option value="fixed_amount">Fixed Pool Amount ($)</option>
                                <option value="legacy_interval">Legacy Intervals (Per $1k Profit)</option>
                            </select>
                        </div>

                        {(calcForm.type === 'custom_percent' || calcForm.type === 'leader_percent') && (
                            <div className="section-box">
                                <div className="flex-row">
                                    <div style={{flex:1}}><label>Leader %</label><input className="calc-input" type="number" value={calcForm.l_pct} onChange={e => setCalcForm({...calcForm, l_pct: e.target.value})} placeholder="5"/></div>
                                    {calcForm.type !== 'leader_percent' && <div style={{flex:1}}><label>Worker %</label><input className="calc-input" type="number" value={calcForm.w_pct} onChange={e => setCalcForm({...calcForm, w_pct: e.target.value})} placeholder="10"/></div>}
                                </div>
                            </div>
                        )}

                        {calcForm.type === 'fixed_amount' && (
                            <div className="section-box">
                                <div className="flex-row">
                                    <div style={{flex:1}}><label>Leader Flat ($)</label><input className="calc-input" type="number" value={calcForm.l_fix} onChange={e => setCalcForm({...calcForm, l_fix: e.target.value})} placeholder="100"/></div>
                                    <div style={{flex:1}}><label>Worker Pool ($)</label><input className="calc-input" type="number" value={calcForm.w_fix} onChange={e => setCalcForm({...calcForm, w_fix: e.target.value})} placeholder="200"/></div>
                                </div>
                            </div>
                        )}

                        {calcForm.type === 'legacy_interval' && (
                            <div className="section-box">
                                <div className="flex-row">
                                    <div style={{flex:1}}><label>L-Amt ($)</label><input className="calc-input" type="number" value={calcForm.l_amt} onChange={e => setCalcForm({...calcForm, l_amt: e.target.value})}/></div>
                                    <div style={{flex:1}}><label>Threshold</label><input className="calc-input" type="number" value={calcForm.l_thr} onChange={e => setCalcForm({...calcForm, l_thr: e.target.value})}/></div>
                                </div>
                                <div className="flex-row">
                                    <div style={{flex:1}}><label>W-Amt ($)</label><input className="calc-input" type="number" value={calcForm.w_amt} onChange={e => setCalcForm({...calcForm, w_amt: e.target.value})}/></div>
                                    <div style={{flex:1}}><label>Threshold</label><input className="calc-input" type="number" value={calcForm.w_thr} onChange={e => setCalcForm({...calcForm, w_thr: e.target.value})}/></div>
                                </div>
                            </div>
                        )}

                        <div className="input-group">
                            <label>Worker Distribution</label>
                            <select value={calcForm.distribution} onChange={e => setCalcForm({...calcForm, distribution: e.target.value})}>
                                <option value="hours">Weighted by Hours (Standard)</option>
                                <option value="even">Even Split</option>
                            </select>
                        </div>

                        <button className="btn-confirm" onClick={saveCalcSettings}>Save Settings</button>
                    </div>
                </div>
            )}

            {/* PAY DATE MODAL */}
            {showPayModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="calc-header">
                            <h3 style={{margin:0}}>Confirm Payment</h3>
                            <span style={{cursor:'pointer'}} onClick={() => setShowPayModal(false)}>✕</span>
                        </div>
                        <div className="input-group">
                            <label>PAY DATE</label>
                            <input 
                                type="date" 
                                className="date-input" 
                                value={payDate} 
                                onChange={(e) => setPayDate(e.target.value)} 
                            />
                        </div>
                        <button className="btn-confirm" onClick={confirmPay}>Confirm & Mark Paid</button>
                        <button className="btn-cancel" onClick={() => setShowPayModal(false)}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Bonuses;