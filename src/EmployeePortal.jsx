import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './EmployeePortal.css';
import { calculateBonuses, getPayDate } from './calculations/bonuses';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const EmployeePortal = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState(null);
    const [workerProfile, setWorkerProfile] = useState(null);
    const [reports, setReports] = useState([]);
    const [config, setConfig] = useState({});
    const [processedData, setProcessedData] = useState([]);
    const [filter, setFilter] = useState('recent'); // recent, all

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUser(user);
                checkWorkerLink(user);
            } else {
                navigate('/');
            }
        });
        return () => unsubscribe();
    }, []);

    const checkWorkerLink = async (user) => {
        // Find worker profile by email
        const q = query(collection(db, "workers"), where("email", "==", user.email.toLowerCase()));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            alert("This email is not linked to a worker profile. Contact manager.");
            navigate('/');
            return;
        }

        const profile = snap.docs[0].data();
        setWorkerProfile(profile);
        
        // Load Config
        const cSnap = await getDoc(doc(db, "config", "finance"));
        if(cSnap.exists()) setConfig(cSnap.data());

        // Load Reports
        loadReports(profile);
    };

    const loadReports = async (profile) => {
        const q = query(collection(db, "reports"), where("financeStatus", "==", "complete"));
        const snap = await getDocs(q);
        const list = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.bonusPaid === true || data.bonusEligible === false) {
                list.push({ id: d.id, ...data });
            }
        });
        setReports(list);
        
        const fullName = profile.name || `${profile.firstName} ${profile.lastName}`;
        const result = calculateBonuses(list, config, [], fullName); // Filter just for me
        setProcessedData(result);
        setLoading(false);
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Portal...</div>;

    // Filter Logic for View
    let displayItems = [];
    if (processedData.length > 0) {
        let items = processedData[0].items; // It's an array of 1 person
        items.sort((a,b) => b.rawDate - a.rawDate);
        
        if (filter === 'recent' && items.length > 0) {
            const latestPayDate = items[0].payDate;
            displayItems = items.filter(i => i.payDate === latestPayDate);
        } else {
            displayItems = items;
        }
    }

    const total = displayItems.reduce((acc, curr) => acc + curr.amount, 0);

    // Group by Pay Date for cards
    const groups = {};
    displayItems.forEach(i => {
        if(!groups[i.payDate]) groups[i.payDate] = [];
        groups[i.payDate].push(i);
    });

    return (
        <div className="portal-wrapper">
            <div className="app-header">
                <div style={{fontWeight:'bold'}}>Bonus Portal</div>
                <div onClick={handleLogout} style={{cursor:'pointer'}}>Sign Out</div>
            </div>

            <div className="portal-container">
                <div className="profile-card">
                    <div>
                        <div style={{fontSize:'12px', color:'#777'}}>WELCOME</div>
                        <div className="user-name">{workerProfile.name || workerProfile.firstName}</div>
                        <div style={{fontSize:'12px', color:'#999'}}>{currentUser.email}</div>
                    </div>
                </div>

                <div className="controls">
                    <div className={`chip ${filter==='recent'?'active':''}`} onClick={() => setFilter('recent')}>Latest Period</div>
                    <div className={`chip ${filter==='all'?'active':''}`} onClick={() => setFilter('all')}>All Time</div>
                </div>

                <div className="total-summary">
                    <div style={{opacity:0.8, fontSize:'12px', textTransform:'uppercase'}}>Total Earnings (This View)</div>
                    <div className="total-val">${total.toFixed(2)}</div>
                </div>

                {Object.keys(groups).map(date => {
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
                                            <div>${item.amount.toFixed(2)}</div>
                                            <div style={{fontSize:'11px', color:'#999'}}>{item.hours.toFixed(1)} hrs</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default EmployeePortal;