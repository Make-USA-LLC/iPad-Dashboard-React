import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './FinanceSetup.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const FinanceSetup = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [canEdit, setCanEdit] = useState(false);
    
    // Data State
    const [configData, setConfigData] = useState({
        costPerHour: 0,
        leaderPoolPercent: 0,
        workerPoolPercent: 0,
        agents: [],
        projectTypes: []
    });

    // Local inputs for "Add" forms
    const [newAgentName, setNewAgentName] = useState('');
    const [newAgentComm, setNewAgentComm] = useState('');
    const [newType, setNewType] = useState('');

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
            startListener();
        } else {
            setLoading(false); // Renders denied message
        }
    };

    const denyAccess = () => {
        setLoading(false);
    };

    const startListener = () => {
        const configRef = doc(db, "config", "finance");
        onSnapshot(configRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setConfigData({
                    costPerHour: data.costPerHour || 0,
                    leaderPoolPercent: data.leaderPoolPercent || 0,
                    workerPoolPercent: data.workerPoolPercent || 0,
                    agents: data.agents || [],
                    projectTypes: data.projectTypes || []
                });
            } else {
                // Initialize if missing
                setDoc(configRef, { 
                    costPerHour: 0, leaderPoolPercent: 0, workerPoolPercent: 0, agents: [], projectTypes: [] 
                });
            }
            setLoading(false);
        });
    };

    // --- HANDLERS ---

    // 1. Save Scalar Values (Costs & Percentages)
    const handleSaveConstants = async () => {
        if (!canEdit) return;
        try {
            const configRef = doc(db, "config", "finance");
            await updateDoc(configRef, {
                costPerHour: parseFloat(configData.costPerHour),
                leaderPoolPercent: parseFloat(configData.leaderPoolPercent),
                workerPoolPercent: parseFloat(configData.workerPoolPercent)
            });
            alert("Configuration Saved");
        } catch(e) { alert("Error saving: " + e.message); }
    };

    // 2. Agents
    const handleAddAgent = async () => {
        if (!canEdit || !newAgentName) return;
        const configRef = doc(db, "config", "finance");
        const updatedAgents = [...configData.agents, { name: newAgentName, comm: parseFloat(newAgentComm) || 0 }];
        await updateDoc(configRef, { agents: updatedAgents });
        setNewAgentName('');
        setNewAgentComm('');
    };

    const handleDeleteAgent = async (index) => {
        if (!canEdit) return;
        const configRef = doc(db, "config", "finance");
        const updatedAgents = [...configData.agents];
        updatedAgents.splice(index, 1);
        await updateDoc(configRef, { agents: updatedAgents });
    };

    // 3. Project Types
    const handleAddType = async () => {
        if (!canEdit || !newType) return;
        const configRef = doc(db, "config", "finance");
        const updatedTypes = [...configData.projectTypes, newType];
        await updateDoc(configRef, { projectTypes: updatedTypes });
        setNewType('');
    };

    const handleDeleteType = async (index) => {
        if (!canEdit) return;
        const configRef = doc(db, "config", "finance");
        const updatedTypes = [...configData.projectTypes];
        updatedTypes.splice(index, 1);
        await updateDoc(configRef, { projectTypes: updatedTypes });
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Config...</div>;
    if (!configData.costPerHour && configData.costPerHour !== 0) return <div className="fs-denied">Access Denied</div>; // Fallback

    return (
        <div className="fs-wrapper">
            <div className="fs-top-bar">
                <button onClick={() => navigate('/')} className="btn-back">&larr; Dashboard</button>
                <div style={{fontWeight:'bold'}}>Finance Setup</div>
                <button onClick={handleLogout} className="btn-back" style={{fontSize:'14px', color:'#e74c3c'}}>Sign Out</button>
            </div>

            <div className="fs-container">
                
                {/* GLOBAL COSTS */}
                <div className="fs-card">
                    <h2>Global Costs</h2>
                    <div className="fs-form-row">
                        <div style={{flex:1}}>
                            <label className="fs-label">Cost Per Labor Hour ($)</label>
                            <input 
                                type="number" 
                                className="fs-input" 
                                step="0.01"
                                value={configData.costPerHour}
                                onChange={(e) => setConfigData({...configData, costPerHour: e.target.value})}
                                disabled={!canEdit}
                            />
                        </div>
                    </div>
                </div>

                {/* BONUS STRUCTURE */}
                <div className="fs-card" style={{borderLeft: '5px solid #3498db'}}>
                    <h2>Standard Bonus Structure</h2>
                    <div className="fs-section-desc">
                        Bonuses are calculated as a percentage of <strong>Net Profit</strong>.<br/>
                        <em>(Net Profit = Invoice - Labor Cost - Commissions)</em>
                    </div>

                    <div className="fs-form-row">
                        <div style={{flex:1}}>
                            <label className="fs-label" style={{color:'#2980b9'}}>Line Leader Pool</label>
                            <div className="fs-input-suffix">
                                <input 
                                    type="number" 
                                    className="fs-input" 
                                    step="0.1" 
                                    value={configData.leaderPoolPercent}
                                    onChange={(e) => setConfigData({...configData, leaderPoolPercent: e.target.value})}
                                    disabled={!canEdit}
                                />
                                <span className="fs-suffix-text">%</span>
                            </div>
                        </div>
                        
                        <div style={{flex:1}}>
                            <label className="fs-label" style={{color:'#27ae60'}}>Worker Pool (Non-Leaders)</label>
                            <div className="fs-input-suffix">
                                <input 
                                    type="number" 
                                    className="fs-input" 
                                    step="0.1" 
                                    value={configData.workerPoolPercent}
                                    onChange={(e) => setConfigData({...configData, workerPoolPercent: e.target.value})}
                                    disabled={!canEdit}
                                />
                                <span className="fs-suffix-text">%</span>
                            </div>
                        </div>
                    </div>
                    
                    <p style={{fontSize:'12px', color:'#999', marginTop:0}}>* Worker pool is split based on hours worked by default.</p>
                    {canEdit && (
                        <button className="btn btn-green" style={{width:'100%', marginTop:'10px'}} onClick={handleSaveConstants}>
                            Save Configuration
                        </button>
                    )}
                </div>

                {/* COMMISSION AGENTS */}
                <div className="fs-card">
                    <h2>Commission Agents</h2>
                    {canEdit && (
                        <div className="fs-form-row">
                            <div style={{flex:2}}>
                                <label className="fs-label">Company/Agent Name</label>
                                <input className="fs-input" value={newAgentName} onChange={e => setNewAgentName(e.target.value)} />
                            </div>
                            <div style={{flex:1}}>
                                <label className="fs-label">Default Comm %</label>
                                <input className="fs-input" type="number" value={newAgentComm} onChange={e => setNewAgentComm(e.target.value)} />
                            </div>
                            <button className="btn btn-green" onClick={handleAddAgent}>Add</button>
                        </div>
                    )}
                    <ul className="fs-list">
                        {configData.agents.map((a, i) => (
                            <li key={i}>
                                <span><b>{a.name}</b> ({a.comm}%)</span>
                                {canEdit && <button className="btn-red-small" onClick={() => handleDeleteAgent(i)}>Del</button>}
                            </li>
                        ))}
                        {configData.agents.length === 0 && <li style={{padding:'15px', color:'#999'}}>No agents defined.</li>}
                    </ul>
                </div>

                {/* PROJECT TYPES */}
                <div className="fs-card">
                    <h2>Project Types</h2>
                    {canEdit && (
                        <div className="fs-form-row">
                            <div style={{flex:1}}>
                                <label className="fs-label">Type Name</label>
                                <input className="fs-input" value={newType} onChange={e => setNewType(e.target.value)} />
                            </div>
                            <button className="btn btn-green" onClick={handleAddType}>Add</button>
                        </div>
                    )}
                    <ul className="fs-list">
                        {configData.projectTypes.map((t, i) => (
                            <li key={i}>
                                <span>{t}</span>
                                {canEdit && <button className="btn-red-small" onClick={() => handleDeleteType(i)}>Del</button>}
                            </li>
                        ))}
                        {configData.projectTypes.length === 0 && <li style={{padding:'15px', color:'#999'}}>No types defined.</li>}
                    </ul>
                </div>

            </div>
        </div>
    );
};

export default FinanceSetup;