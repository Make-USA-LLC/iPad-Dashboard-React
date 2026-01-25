import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Commisions.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const Commissions = () => {
    const navigate = useNavigate();
    const [view, setView] = useState('unpaid');
    const [reports, setReports] = useState([]);
    const [config, setConfig] = useState({});
    const [loading, setLoading] = useState(true);
    const [agentTotals, setAgentTotals] = useState({});
    
    // Modal State
    const [showPayModal, setShowPayModal] = useState(false);
    const [payTargetId, setPayTargetId] = useState(null);
    const [payDate, setPayDate] = useState('');

    // Permissions
    const [canEditFinance, setCanEditFinance] = useState(false);
    const [canViewAll, setCanViewAll] = useState(false);

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
        let edit = false;
        let view = false;

        if (r === 'admin') { edit = true; view = true; }
        else if (rolesSnap.exists()) {
            const rc = rolesSnap.data()[r];
            if (rc) {
                if (rc['finance_edit']) edit = true;
                if (rc['finance_view'] || rc['commissions_view']) view = true;
            }
        }

        if (edit || view) {
            setCanEditFinance(edit);
            setCanViewAll(edit); // Usually editors can view all
            await loadConfig();
            loadData(edit);
        } else {
            alert("Access Denied");
            navigate('/');
        }
    };

    const loadConfig = async () => {
        const cSnap = await getDoc(doc(db, "config", "finance"));
        if(cSnap.exists()) setConfig(cSnap.data());
    };

    const loadData = async (isEditor) => {
        setLoading(true);
        const q = query(collection(db, "reports"), where("financeStatus", "==", "complete"));
        const snap = await getDocs(q);
        
        let list = [];
        const totals = {};

        snap.forEach(d => {
            const data = d.data();
            if (!data.agentName) return;

            const isPaid = data.commissionPaid === true;
            
            // Filter View
            if (view === 'unpaid' && isPaid) return;
            if (view === 'paid' && !isPaid) return;

            // Calculate Comm
            let rate = 0;
            if (config.agents) {
                const ag = config.agents.find(a => a.name === data.agentName);
                if(ag) rate = parseFloat(ag.comm);
            }
            const invoice = data.invoiceAmount || 0;
            const excluded = data.commissionExcluded || 0;
            const basis = Math.max(0, invoice - excluded);
            const commAmt = basis * (rate / 100);

            // Add to totals
            if(!totals[data.agentName]) totals[data.agentName] = 0;
            totals[data.agentName] += commAmt;

            list.push({ 
                id: d.id, ...data, 
                commAmount: commAmt, 
                rate: rate,
                basis: basis,
                excluded: excluded 
            });
        });

        list.sort((a,b) => (b.completedAt?.seconds||0) - (a.completedAt?.seconds||0));
        setReports(list);
        setAgentTotals(totals);
        setLoading(false);
    };

    useEffect(() => {
        if(config.agents) loadData(canEditFinance);
    }, [view, config]);

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    // --- ACTIONS ---
    const openPayModal = (id) => {
        setPayTargetId(id);
        setPayDate(new Date().toISOString().split('T')[0]);
        setShowPayModal(true);
    };

    const confirmPay = async () => {
        if(!payDate) return alert("Select Date");
        const parts = payDate.split('-');
        const fmtDate = `${parts[1]}/${parts[2]}/${parts[0]}`;

        await updateDoc(doc(db, "reports", payTargetId), { 
            commissionPaid: true, commissionPaidAt: new Date(), commissionPaidDate: fmtDate 
        });
        setShowPayModal(false);
        loadData(canEditFinance);
    };

    const undoPay = async (id) => {
        if(!window.confirm("Undo payment status?")) return;
        await updateDoc(doc(db, "reports", id), { commissionPaid: false, commissionPaidDate: null });
        loadData(canEditFinance);
    };

    const grandTotal = Object.values(agentTotals).reduce((a,b) => a+b, 0);

    return (
        <div className="commissions-page-wrapper">
            <div className="commissions-top-bar">
                <button onClick={() => navigate('/')} style={{border:'none', background:'none', fontWeight:'bold', cursor:'pointer'}}>&larr; Dashboard</button>
                <div className="view-toggle">
                    <button className={`toggle-btn ${view==='unpaid'?'active':''}`} onClick={() => setView('unpaid')}>Pending</button>
                    <button className={`toggle-btn ${view==='paid'?'active paid':''}`} onClick={() => setView('paid')}>History</button>
                </div>
                <button onClick={handleLogout} style={{color:'#e74c3c', border:'none', background:'none', fontWeight:'bold', cursor:'pointer'}}>Sign Out</button>
            </div>

            <div className="commissions-container">
                {/* BREAKDOWN */}
                {view === 'unpaid' && (
                    <div className="overview-panel">
                        <div className="overview-header">
                            <span>Commission Breakdown</span>
                            <span className="overview-total">${grandTotal.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
                        </div>
                        {Object.keys(agentTotals).sort().map(name => (
                            <div key={name} className="agent-row">
                                <div className="agent-name"><span className="material-icons" style={{fontSize:'16px', color:'#ccc'}}>person</span> {name}</div>
                                <div className="agent-val">${agentTotals[name].toFixed(2)}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* CARDS */}
                <div className="commissions-grid">
                    {reports.map(r => {
                        const dateStr = r.completedAt ? new Date(r.completedAt.seconds*1000).toLocaleDateString() : 'N/A';
                        
                        return (
                            <div key={r.id} className="project-card">
                                <div className="card-header">
                                    <div className="project-name">{r.project}</div>
                                    <div className="project-meta">
                                        <span>{r.company}</span>
                                        <span>{dateStr}</span>
                                    </div>
                                </div>
                                <div className="card-body">
                                    <div className="data-row"><span>Agent</span><span className="data-val">{r.agentName}</span></div>
                                    <div className="data-row"><span>Invoice</span><span className="data-val">${r.invoiceAmount?.toLocaleString()}</span></div>
                                    {r.excluded > 0 && (
                                        <div className="data-row" style={{color:'#e67e22', fontSize:'11px'}}>
                                            <span>Less Excluded</span><span>-${r.excluded.toLocaleString()}</span>
                                        </div>
                                    )}
                                    <div className="highlight-row">
                                        <div className="data-row" style={{marginBottom:0, alignItems:'center'}}>
                                            <span>{r.rate}% Comm.</span>
                                            <span className="comm-total">${r.commAmount.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="card-footer">
                                    {canEditFinance ? (
                                        view === 'unpaid' ? (
                                            <button className="btn-pay" onClick={() => openPayModal(r.id)}>Mark Paid ${r.commAmount.toFixed(2)}</button>
                                        ) : (
                                            <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', gap:'10px'}}>
                                                <span style={{color:'#27ae60', fontSize:'12px'}}>Paid {r.commissionPaidDate}</span>
                                                <button className="btn-undo" onClick={() => undoPay(r.id)}>Undo</button>
                                            </div>
                                        )
                                    ) : (
                                        <span className={`status-badge ${view==='paid'?'badge-paid':''}`}>
                                            {view==='paid' ? `Paid ${r.commissionPaidDate}` : 'Pending'}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* MODAL */}
            {showPayModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="calc-header">
                            <h3 style={{margin:0}}>Mark Paid</h3>
                            <span style={{cursor:'pointer'}} onClick={() => setShowPayModal(false)}>✕</span>
                        </div>
                        <div className="input-group">
                            <label>PAY DATE</label>
                            <input type="date" className="date-input" value={payDate} onChange={e => setPayDate(e.target.value)} />
                        </div>
                        <button className="btn-confirm" onClick={confirmPay}>Confirm Payment</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Commissions;