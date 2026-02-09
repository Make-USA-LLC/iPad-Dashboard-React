import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './EmployeePortal.css';
import { calculateBonuses, getPayDate } from './calculations/bonuses';
import { db, auth } from './firebase_config.jsx';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { 
    onAuthStateChanged, 
    signOut, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail 
} from 'firebase/auth';

const EmployeePortal = () => {
    const navigate = useNavigate();
    
    // --- STATE ---
    const [loading, setLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState(null);
    
    // Portal Data State
    const [workerProfile, setWorkerProfile] = useState(null);
    const [processedData, setProcessedData] = useState([]);
    const [filter, setFilter] = useState('recent');
    const [accessDenied, setAccessDenied] = useState(false);

    // Auth UI State
    const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup' | 'forgot'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authMsg, setAuthMsg] = useState({ type: '', text: '' });

    // --- 1. AUTH LISTENER ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                checkWorkerLink(user);
            } else {
                setCurrentUser(null);
                setWorkerProfile(null);
                setProcessedData([]);
                setAccessDenied(false);
                setLoading(false);
            }
        });
        return () => unsubscribe();
    }, []);

    // --- 2. DATA FETCHING ---
    const checkWorkerLink = async (user) => {
        setLoading(true);
        try {
            // Find worker profile by email
            const q = query(collection(db, "workers"), where("email", "==", user.email.toLowerCase()));
            const snap = await getDocs(q);
            
            if (snap.empty) {
                setAccessDenied(true);
                setLoading(false);
                return;
            }

            const profile = snap.docs[0].data();
            setWorkerProfile(profile);
            
            // Load Config & Reports
            const cSnap = await getDoc(doc(db, "config", "finance"));
            const config = cSnap.exists() ? cSnap.data() : {};
            
            await loadReports(profile, config);
        } catch (error) {
            console.error(error);
            setAuthMsg({ type: 'error', text: "System Error: " + error.message });
        }
        setLoading(false);
    };

    const loadReports = async (profile, config) => {
        const q = query(collection(db, "reports"), where("financeStatus", "==", "complete"));
        const snap = await getDocs(q);
        const list = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.bonusPaid === true || data.bonusEligible === false) {
                list.push({ id: d.id, ...data });
            }
        });
        
        const fullName = profile.name || `${profile.firstName} ${profile.lastName}`;
        const result = calculateBonuses(list, config, [], fullName);
        setProcessedData(result);
    };

    // --- 3. AUTH HANDLERS ---
    const handleAuth = async (e) => {
        e.preventDefault();
        setAuthMsg({ type: '', text: '' });

        if (authMode === 'signup' && password.length < 8) {
            setAuthMsg({ type: 'error', text: "Password must be at least 8 characters." });
            return;
        }

        try {
            if (authMode === 'signin') {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
            // Listener handles the rest
        } catch (error) {
            let msg = error.message;
            if (msg.includes('auth/wrong-password')) msg = "Incorrect password.";
            if (msg.includes('auth/user-not-found')) msg = "No account found.";
            if (msg.includes('auth/email-already-in-use')) msg = "Email already exists.";
            setAuthMsg({ type: 'error', text: msg });
        }
    };

    const handleReset = async () => {
        if (!email) {
            setAuthMsg({ type: 'error', text: "Please enter your email address first." });
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            setAuthMsg({ type: 'success', text: "Reset link sent! Check your inbox." });
        } catch (error) {
            setAuthMsg({ type: 'error', text: error.message });
        }
    };

    const handleLogout = () => signOut(auth);

    // --- 4. RENDER: LOADING ---
    if (loading) return <div style={{padding:'50px', textAlign:'center', color:'#555'}}>Loading...</div>;

    // --- 5. RENDER: NOT LOGGED IN (AUTH UI) ---
    if (!currentUser) {
        return (
            <div className="auth-wrapper">
                <div className="login-card">
                    <div className="logo-section">
                        <span className="material-icons" style={{color:'#27ae60'}}>savings</span> Make USA
                    </div>
                    <div className="subtitle">Employee Bonus Portal</div>

                    {authMode !== 'forgot' ? (
                        <>
                            <div className="auth-tabs">
                                <div className={`auth-tab ${authMode==='signin'?'active':''}`} onClick={() => setAuthMode('signin')}>Sign In</div>
                                <div className={`auth-tab ${authMode==='signup'?'active':''}`} onClick={() => setAuthMode('signup')}>Create Account</div>
                            </div>

                            <form onSubmit={handleAuth}>
                                <input 
                                    className="login-input" 
                                    type="email" 
                                    placeholder="Email Address" 
                                    value={email} onChange={e=>setEmail(e.target.value)} 
                                    required 
                                />
                                <input 
                                    className="login-input" 
                                    type="password" 
                                    placeholder="Password" 
                                    value={password} onChange={e=>setPassword(e.target.value)} 
                                    required 
                                />
                                <button type="submit" className="btn-login">
                                    {authMode === 'signin' ? "Sign In" : "Create Account"}
                                </button>
                            </form>

                            <a className="auth-link" onClick={() => { setAuthMode('forgot'); setAuthMsg({}); }}>Forgot Password?</a>
                        </>
                    ) : (
                        // FORGOT PASSWORD VIEW
                        <>
                            <div style={{fontWeight:'bold', marginBottom:'10px'}}>Reset Password</div>
                            <p style={{fontSize:'13px', color:'#666', marginBottom:'20px'}}>Enter email to receive reset link.</p>
                            <input 
                                className="login-input" 
                                type="email" 
                                placeholder="Email Address" 
                                value={email} onChange={e=>setEmail(e.target.value)} 
                            />
                            <button className="btn-login" onClick={handleReset}>Send Reset Link</button>
                            <button className="btn-login btn-secondary" onClick={() => { setAuthMode('signin'); setAuthMsg({}); }}>Back to Login</button>
                        </>
                    )}

                    {authMsg.text && (
                        <div className={`msg-box ${authMsg.type === 'error' ? 'msg-error' : 'msg-success'}`}>
                            {authMsg.text}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // --- 6. RENDER: ACCESS DENIED ---
    if (accessDenied) {
        return (
            <div className="auth-wrapper">
                <div className="login-card">
                    <div className="error-box">
                        <h3>Account Not Linked</h3>
                        <p>The email <strong>{currentUser.email}</strong> is not linked to a worker profile.</p>
                        <p style={{fontSize:'12px', marginTop:'10px'}}>Please ask your manager to link your email.</p>
                    </div>
                    <button className="btn-login btn-secondary" onClick={handleLogout}>Sign Out</button>
                </div>
            </div>
        );
    }

    // --- 7. RENDER: MAIN PORTAL ---
    // Prepare Data for View
    let displayItems = [];
    if (processedData.length > 0) {
        let items = processedData[0].items || []; 
        items.sort((a,b) => b.rawDate - a.rawDate);
        
        if (filter === 'recent' && items.length > 0) {
            const latestPayDate = items[0].payDate;
            displayItems = items.filter(i => i.payDate === latestPayDate);
        } else {
            displayItems = items;
        }
    }

    const total = displayItems.reduce((acc, curr) => acc + curr.amount, 0);
    const groups = {};
    displayItems.forEach(i => {
        if(!groups[i.payDate]) groups[i.payDate] = [];
        groups[i.payDate].push(i);
    });

    return (
        <div className="portal-wrapper">
            <div className="app-header">
                <div style={{fontWeight:'bold', display:'flex', alignItems:'center', gap:'10px'}}>
                    <span className="material-icons">savings</span> Bonus Portal
                </div>
                <div onClick={handleLogout} style={{cursor:'pointer', fontSize:'13px', display:'flex', alignItems:'center', gap:'5px'}}>
                    <span className="material-icons" style={{fontSize:'16px'}}>logout</span> Sign Out
                </div>
            </div>

            <div className="portal-container">
                <div className="profile-card">
                    <div>
                        <div style={{fontSize:'12px', color:'#777'}}>WELCOME</div>
                        <div className="user-name">{workerProfile?.name || workerProfile?.firstName}</div>
                        <div style={{fontSize:'12px', color:'#999'}}>{currentUser.email}</div>
                    </div>
                    <span className="material-icons" style={{fontSize:'40px', color:'#3498db'}}>account_circle</span>
                </div>

                <div className="controls">
                    <div className={`chip ${filter==='recent'?'active':''}`} onClick={() => setFilter('recent')}>Latest Period</div>
                    <div className={`chip ${filter==='all'?'active':''}`} onClick={() => setFilter('all')}>All Time</div>
                </div>

                <div className="total-summary">
                    <div style={{opacity:0.8, fontSize:'12px', textTransform:'uppercase'}}>Total Earnings (This View)</div>
                    <div className="total-val">${total.toFixed(2)}</div>
                </div>

                {Object.keys(groups).length === 0 ? (
                    <div className="empty-state">No bonus records found.</div>
                ) : (
                    Object.keys(groups).map(date => {
                        const groupTotal = groups[date].reduce((s, x) => s + x.amount, 0);
                        return (
                            <div key={date} className="slip-card">
                                <div className="slip-header">
                                    <div>PAY DATE: {date}</div>
                                    <div className="slip-amount">${groupTotal.toFixed(2)}</div>
                                </div>
                                <div>
                                    {groups[date].map((item, ix) => (
                                        <div key={ix} className="job-row">
                                            <div>
                                                <div className="job-title">{item.project}</div>
                                                <div style={{fontSize:'11px', color:'#999'}}>{item.company} • {item.role}</div>
                                            </div>
                                            <div className="job-money">
                                                <div>
                                                    {item.isIneligible 
                                                        ? <span className="ineligible-tag">{item.reason || "Ineligible"}</span> 
                                                        : `$${item.amount.toFixed(2)}`
                                                    }
                                                </div>
                                                <div style={{fontSize:'11px', color:'#999'}}>{item.hours.toFixed(1)} hrs</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default EmployeePortal;