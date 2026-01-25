import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './AgentPortal.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const AgentPortal = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const viewAsParam = searchParams.get('viewAs'); // Check for impersonation

    const [currentUser, setCurrentUser] = useState(null);
    const [agentName, setAgentName] = useState('');
    const [reports, setReports] = useState([]);
    const [config, setConfig] = useState({});
    const [filter, setFilter] = useState('pending'); // 'pending' or 'paid'
    const [loading, setLoading] = useState(true);
    
    // Admin Impersonation State
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                initPortal(user);
            } else {
                navigate('/');
            }
        });
        return () => unsubscribe();
    }, [viewAsParam]); // Re-run if query param changes

    const initPortal = async (user) => {
        // 1. Load User Role
        const uSnap = await getDoc(doc(db, "users", user.email.toLowerCase()));
        if (!uSnap.exists()) return navigate('/'); 
        const role = uSnap.data().role;

        // 2. Check Admin Status
        let admin = (role === 'admin');
        if (!admin) {
            const rolesSnap = await getDoc(doc(db, "config", "roles"));
            if (rolesSnap.exists()) {
                const rc = rolesSnap.data()[role];
                if (rc && rc['admin_view']) admin = true;
            }
        }
        setIsAdmin(admin);

        // 3. Load Finance Config (for rates)
        const cSnap = await getDoc(doc(db, "config", "finance"));
        if (!cSnap.exists()) { alert("Config Error"); return; }
        const financeData = cSnap.data();
        setConfig(financeData);

        // 4. Determine Agent Identity
        let targetAgent = "";

        if (admin && viewAsParam) {
            // Admin Impersonating
            targetAgent = decodeURIComponent(viewAsParam);
        } else {
            // Standard User - Find Linked Agent
            const agentsList = financeData.agents || [];
            const myEmail = user.email.toLowerCase();
            const found = agentsList.find(a => (a.email || '').toLowerCase() === myEmail);
            
            if (found) {
                targetAgent = found.name;
            } else {
                if(admin) {
                    // Admin logged in without impersonation -> Show blank/selector hint
                    setLoading(false);
                    return; 
                } else {
                    alert("Your email is not linked to an Agent account.");
                    navigate('/');
                    return;
                }
            }
        }

        setAgentName(targetAgent);
        loadReports(targetAgent, financeData);
    };

    const loadReports = async (target, financeConfig) => {
        const q = query(collection(db, "reports"), where("financeStatus", "==", "complete"));
        const snap = await getDocs(q);
        
        let list = [];
        snap.forEach(d => {
            const data = d.data();
            // Filter by Agent Name
            if (data.agentName === target) {
                // Calculate Commission here for display
                let rate = 0;
                if(financeConfig.agents) {
                    const ag = financeConfig.agents.find(a => a.name === target);
                    if(ag) rate = parseFloat(ag.comm);
                }
                
                const invoice = data.invoiceAmount || 0;
                const excluded = data.commissionExcluded || 0;
                const basis = Math.max(0, invoice - excluded);
                const commAmt = basis * (rate / 100);

                list.push({ 
                    id: d.id, ...data, 
                    commAmount: commAmt, 
                    rate: rate, 
                    excluded: excluded 
                });
            }
        });

        // Sort by date desc
        list.sort((a,b) => (b.completedAt?.seconds||0) - (a.completedAt?.seconds||0));
        setReports(list);
        setLoading(false);
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    // --- RENDER HELPERS ---
    const filteredReports = reports.filter(r => {
        const isPaid = r.commissionPaid === true;
        return filter === 'paid' ? isPaid : !isPaid;
    });

    const totalAmt = filteredReports.reduce((s, r) => s + r.commAmount, 0);

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Portal...</div>;

    return (
        <div className="agent-portal-wrapper">
            {/* ADMIN TOOLBAR */}
            {isAdmin && (
                <div className="ap-admin-toolbar">
                    <div><span className="ap-admin-badge">ADMIN</span> Viewing as: <strong>{agentName || "None"}</strong></div>
                    <div>
                        <button onClick={() => navigate('/agent-management')} style={{background:'none', border:'1px solid rgba(255,255,255,0.5)', color:'white', padding:'4px 10px', borderRadius:'4px', cursor:'pointer'}}>Back to Management</button>
                    </div>
                </div>
            )}

            <div className="agent-portal-header">
                <div className="portal-title"><span className="material-icons">pie_chart</span> Commissions</div>
                <div onClick={handleLogout} style={{cursor:'pointer', display:'flex', alignItems:'center', gap:'5px', fontSize:'13px'}}>
                    <span className="material-icons" style={{fontSize:'16px'}}>logout</span> Sign Out
                </div>
            </div>

            <div className="agent-portal-container">
                <div className="ap-profile-card">
                    <div>
                        <div className="welcome-text">Agent Profile</div>
                        <div className="ap-user-name">{agentName || "Unknown"}</div>
                    </div>
                    <div><span className="material-icons" style={{fontSize:'40px', color:'#8e44ad'}}>badge</span></div>
                </div>

                <div className="ap-controls">
                    <div className={`ap-chip ${filter==='pending'?'active':''}`} onClick={() => setFilter('pending')}>Pending Payment</div>
                    <div className={`ap-chip ${filter==='paid'?'active':''}`} onClick={() => setFilter('paid')}>Payment History</div>
                </div>

                <div className="ap-total-summary">
                    <div className="total-label">Total Amount</div>
                    <div className="ap-total-val">${totalAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                </div>

                <div>
                    {filteredReports.length === 0 && <div style={{textAlign:'center', padding:'40px', color:'#999'}}>No records found.</div>}
                    
                    {filteredReports.map(r => {
                        const dateStr = r.completedAt ? new Date(r.completedAt.seconds*1000).toLocaleDateString() : 'N/A';
                        const statusBadge = r.commissionPaid 
                            ? <span style={{background:'#d4efdf', color:'#1e8449', padding:'2px 6px', borderRadius:'4px', fontSize:'11px', fontWeight:'bold'}}>PAID {r.commissionPaidDate}</span>
                            : <span style={{background:'#fcf3cf', color:'#b7950b', padding:'2px 6px', borderRadius:'4px', fontSize:'11px', fontWeight:'bold'}}>PENDING</span>;

                        return (
                            <div key={r.id} className="ap-comm-card">
                                <div className="ap-comm-header">
                                    <span className="ap-comm-date">{dateStr}</span>
                                    {statusBadge}
                                </div>
                                <div className="ap-comm-body">
                                    <div style={{fontWeight:'bold', color:'#2c3e50', fontSize:'16px'}}>{r.project}</div>
                                    <div style={{color:'#7f8c8d', fontSize:'13px', marginBottom:'15px'}}>{r.company}</div>
                                    
                                    <div className="ap-financials">
                                        <div>
                                            <div style={{fontSize:'12px', color:'#999'}}>INVOICE</div>
                                            <div className="ap-fin-val">${r.invoiceAmount?.toLocaleString()}</div>
                                        </div>
                                        {r.excluded > 0 && (
                                            <div style={{textAlign:'center'}}>
                                                <div style={{fontSize:'12px', color:'#e67e22'}}>LESS</div>
                                                <div className="ap-fin-val" style={{color:'#e67e22'}}>-${r.excluded.toLocaleString()}</div>
                                            </div>
                                        )}
                                        <div style={{textAlign:'center'}}>
                                            <div style={{fontSize:'12px', color:'#999'}}>RATE</div>
                                            <div className="ap-fin-val">{r.rate}%</div>
                                        </div>
                                        <div style={{textAlign:'right'}}>
                                            <div style={{fontSize:'12px', color:'#999'}}>EARNINGS</div>
                                            <div className="ap-final-amt">${r.commAmount.toFixed(2)}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default AgentPortal;