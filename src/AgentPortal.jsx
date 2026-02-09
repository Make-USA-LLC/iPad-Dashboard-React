import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './AgentPortal.css';
import { db, auth } from './firebase_config.jsx';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { 
    onAuthStateChanged, 
    signOut, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword 
} from 'firebase/auth';

const AgentPortal = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const viewAsParam = searchParams.get('viewAs');

    // --- STATE ---
    const [loading, setLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState(null);
    
    // Portal Data
    const [agentName, setAgentName] = useState('');
    const [reports, setReports] = useState([]);
    const [config, setConfig] = useState({});
    const [filter, setFilter] = useState('pending'); 
    const [isAdmin, setIsAdmin] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);

    // Auth UI State
    const [authMode, setAuthMode] = useState('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authMsg, setAuthMsg] = useState({ type: '', text: '' });

    // --- 1. AUTH LISTENER ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                initPortal(user);
            } else {
                setCurrentUser(null);
                setAgentName('');
                setReports([]);
                setAccessDenied(false);
                setLoading(false);
            }
        });
        return () => unsubscribe();
    }, [viewAsParam]);

    // --- 2. AUTH HANDLERS ---
    const handleAuth = async (e) => {
        e.preventDefault();
        setAuthMsg({ type: '', text: '' });

        try {
            if (authMode === 'signin') {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (error) {
            let msg = error.message;
            if (msg.includes('auth/email-already-in-use')) msg = "Account exists. Please Sign In.";
            if (msg.includes('auth/wrong-password')) msg = "Invalid password.";
            if (msg.includes('auth/user-not-found')) msg = "No account found.";
            setAuthMsg({ type: 'error', text: msg });
        }
    };

    const handleLogout = () => signOut(auth);

    // --- 3. PORTAL INIT LOGIC ---
    const initPortal = async (user) => {
        setLoading(true);
        try {
            // 1. Check User Doc
            const uSnap = await getDoc(doc(db, "users", user.email.toLowerCase()));
            // Note: Agents might not have a "users" doc initially if they just signed up via Portal
            // So we skip hard failure here and rely on Config check below
            
            const role = uSnap.exists() ? uSnap.data().role : 'agent'; 

            // 2. Check Admin Status
            let admin = (role === 'admin');
            if (!admin && uSnap.exists()) {
                const rolesSnap = await getDoc(doc(db, "config", "roles"));
                if (rolesSnap.exists()) {
                    const rc = rolesSnap.data()[role];
                    if (rc && rc['admin_view']) admin = true;
                }
            }
            setIsAdmin(admin);

            // 3. Load Finance Config
            const cSnap = await getDoc(doc(db, "config", "finance"));
            if (!cSnap.exists()) throw new Error("System config missing.");
            const financeData = cSnap.data();
            setConfig(financeData);

            // 4. Determine Agent Identity
            let targetAgent = "";

            if (admin && viewAsParam) {
                targetAgent = decodeURIComponent(viewAsParam);
            } else {
                // Find Linked Agent
                const agentsList = financeData.agents || [];
                const myEmail = user.email.toLowerCase();
                const found = agentsList.find(a => (a.email || '').toLowerCase() === myEmail);
                
                if (found) {
                    targetAgent = found.name;
                } else {
                    if (admin) {
                        setLoading(false);
                        return; // Admin without viewAs -> Show empty state
                    } else {
                        setAccessDenied(true);
                        setLoading(false);
                        return;
                    }
                }
            }

            setAgentName(targetAgent);
            await loadReports(targetAgent, financeData);

        } catch (e) {
            console.error(e);
            setAuthMsg({ type: 'error', text: "Init Error: " + e.message });
        }
        setLoading(false);
    };

    const loadReports = async (target, financeConfig) => {
        const q = query(collection(db, "reports"), where("financeStatus", "==", "complete"));
        const snap = await getDocs(q);
        
        let list = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.agentName === target) {
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

        list.sort((a,b) => (b.completedAt?.seconds||0) - (a.completedAt?.seconds||0));
        setReports(list);
    };

    // --- 4. RENDER HELPERS ---
    const filteredReports = reports.filter(r => {
        const isPaid = r.commissionPaid === true;
        return filter === 'paid' ? isPaid : !isPaid;
    });

    const totalAmt = filteredReports.reduce((s, r) => s + r.commAmount, 0);

    // --- 5. RENDER: LOADING ---
    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading...</div>;

    // --- 6. RENDER: LOGIN SCREEN (If no user) ---
    if (!currentUser) {
        return (
            <div className="ap-auth-wrapper">
                <div className="ap-login-card">
                    <div className="ap-logo-section">
                        <span className="material-icons">work_outline</span> Agent Portal
                    </div>
                    <div className="ap-subtitle">Commission Tracking System</div>

                    <div className="ap-auth-tabs">
                        <div className={`ap-auth-tab ${authMode==='signin'?'active':''}`} onClick={() => setAuthMode('signin')}>Sign In</div>
                        <div className={`ap-auth-tab ${authMode==='signup'?'active':''}`} onClick={() => setAuthMode('signup')}>Create Account</div>
                    </div>

                    <form onSubmit={handleAuth}>
                        <input 
                            className="ap-login-input" type="email" placeholder="Email Address" 
                            value={email} onChange={e=>setEmail(e.target.value)} required 
                        />
                        <input 
                            className="ap-login-input" type="password" placeholder="Password" 
                            value={password} onChange={e=>setPassword(e.target.value)} required 
                        />
                        <button type="submit" className="ap-btn-login">
                            {authMode === 'signin' ? "Sign In" : "Create Account"}
                        </button>
                    </form>

                    {authMsg.text && (
                        <div className={`ap-msg-box ap-msg-error`}>{authMsg.text}</div>
                    )}
                </div>
            </div>
        );
    }

    // --- 7. RENDER: ACCESS DENIED ---
    if (accessDenied) {
        return (
            <div className="ap-auth-wrapper">
                <div className="ap-login-card">
                    <div className="ap-msg-box ap-msg-error" style={{textAlign:'center'}}>
                        <h3>Account Not Linked</h3>
                        <p>Email <strong>{currentUser.email}</strong> is not linked to an Agent Profile.</p>
                        <p>Please contact Admin.</p>
                    </div>
                    <button className="ap-btn-login ap-btn-secondary" onClick={handleLogout}>Sign Out</button>
                </div>
            </div>
        );
    }

    // --- 8. RENDER: MAIN DASHBOARD ---
    return (
        <div className="agent-portal-wrapper">
            {isAdmin && (
                <div className="ap-admin-toolbar">
                    <div><span className="ap-admin-badge">ADMIN</span> Viewing as: <strong>{agentName || "None"}</strong></div>
                    <div>
                        <button onClick={() => navigate('/agent-management')} style={{background:'none', border:'1px solid rgba(255,255,255,0.5)', color:'white', padding:'4px 10px', borderRadius:'4px', cursor:'pointer'}}>Back to Management</button>
                    </div>
                </div>
            )}

            <div className="agent-portal-header">
                <div className="portal-title" style={{fontWeight:'bold', display:'flex', alignItems:'center', gap:'10px'}}>
                    <span className="material-icons">pie_chart</span> Commissions
                </div>
                <div onClick={handleLogout} style={{cursor:'pointer', display:'flex', alignItems:'center', gap:'5px', fontSize:'13px'}}>
                    <span className="material-icons" style={{fontSize:'16px'}}>logout</span> Sign Out
                </div>
            </div>

            <div className="agent-portal-container">
                <div className="ap-profile-card">
                    <div>
                        <div className="welcome-text" style={{fontSize:'12px', color:'#777', fontWeight:'bold', textTransform:'uppercase'}}>Agent Profile</div>
                        <div className="ap-user-name">{agentName || "Unknown"}</div>
                    </div>
                    <div><span className="material-icons" style={{fontSize:'40px', color:'#8e44ad'}}>badge</span></div>
                </div>

                <div className="ap-controls">
                    <div className={`ap-chip ${filter==='pending'?'active':''}`} onClick={() => setFilter('pending')}>Pending Payment</div>
                    <div className={`ap-chip ${filter==='paid'?'active':''}`} onClick={() => setFilter('paid')}>Payment History</div>
                </div>

                <div className="ap-total-summary">
                    <div style={{fontSize:'12px', textTransform:'uppercase', opacity:0.8}}>Total Amount</div>
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