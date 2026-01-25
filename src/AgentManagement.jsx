import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './AgentManagement.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const AgentManagement = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [currentUserRole, setCurrentUserRole] = useState('');
    const [financeConfig, setFinanceConfig] = useState({ agents: [] });
    const [impersonateTarget, setImpersonateTarget] = useState('');

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
        setCurrentUserRole(role);

        const rolesSnap = await getDoc(doc(db, "config", "roles"));
        let hasAccess = false;
        
        if (role === 'admin') {
            hasAccess = true;
        } else if (rolesSnap.exists()) {
            const rConfig = rolesSnap.data()[role];
            if (rConfig && (rConfig['admin_edit'] || rConfig['finance_edit'])) {
                hasAccess = true;
            }
        }

        if (!hasAccess) return denyAccess();
        loadAgents();
        setLoading(false);
    };

    const denyAccess = () => {
        alert("Access Denied.");
        navigate('/');
    };

    const loadAgents = async () => {
        const snap = await getDoc(doc(db, "config", "finance"));
        if (snap.exists()) {
            setFinanceConfig(snap.data());
        }
    };

    const handleEmailChange = (index, newVal) => {
        const updatedAgents = [...financeConfig.agents];
        updatedAgents[index].email = newVal;
        setFinanceConfig({ ...financeConfig, agents: updatedAgents });
    };

    const handleSaveEmail = async (index) => {
        try {
            const agentToSave = financeConfig.agents[index];
            if(!agentToSave) return;
            await setDoc(doc(db, "config", "finance"), { agents: financeConfig.agents }, { merge: true });
            alert(`Saved email for ${agentToSave.name}`);
        } catch (e) {
            alert("Error saving: " + e.message);
        }
    };

    // --- FIX IS HERE ---
    const handleImpersonate = () => {
        if (!impersonateTarget) return alert("Please select an agent.");
        
        // OLD: window.open(`/agent_portal.html?viewAs=${encodeURIComponent(impersonateTarget)}`, '_blank');
        
        // NEW: Points to the React Route
        const url = `/agent-portal?viewAs=${encodeURIComponent(impersonateTarget)}`;
        window.open(url, '_blank');
    };

    const handleLogout = () => {
        signOut(auth).then(() => window.location.href = '/');
    };

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading...</div>;
    const isAdmin = currentUserRole === 'admin';

    return (
        <div className="agent-page-wrapper">
            <div className="agent-top-bar">
                <button onClick={() => navigate('/')} style={{background:'none', border:'none', fontSize:'16px', fontWeight:'bold', cursor:'pointer', color:'#2c3e50'}}>&larr; Dashboard</button>
                <div style={{fontWeight:'bold', color:'#8e44ad'}}>Agent Management</div>
                <button onClick={handleLogout} className="btn-red-text">Sign Out</button>
            </div>

            <div className="agent-container">
                {isAdmin && (
                    <div className="admin-box">
                        <div>
                            <strong style={{color:'#8e44ad', display:'block'}}>Admin Access</strong>
                            <span style={{fontSize:'12px', color:'#666'}}>View portal as agent:</span>
                        </div>
                        <select value={impersonateTarget} onChange={(e) => setImpersonateTarget(e.target.value)}>
                            <option value="">Select an Agent...</option>
                            {financeConfig.agents?.map((a, i) => (
                                <option key={i} value={a.name}>{a.name}</option>
                            ))}
                        </select>
                        <button className="btn btn-purple" onClick={handleImpersonate}>Open Portal &rarr;</button>
                    </div>
                )}

                <div className="agent-card">
                    <h2>Link Emails to Agents</h2>
                    <table className="agent-table">
                        <thead><tr><th>Agent / Company</th><th>Authorized Email</th><th style={{width:'100px'}}>Action</th></tr></thead>
                        <tbody>
                            {financeConfig.agents?.map((agent, index) => (
                                <tr key={index}>
                                    <td><span className="agent-name">{agent.name}</span> <span className="comm-rate">{agent.comm}%</span></td>
                                    <td><input type="email" className="agent-input" value={agent.email || ''} onChange={(e) => handleEmailChange(index, e.target.value)} placeholder="agent@company.com"/></td>
                                    <td><button className="btn btn-green" onClick={() => handleSaveEmail(index)}>Save</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AgentManagement;