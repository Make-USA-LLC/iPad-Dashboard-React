import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; // 1. Import Hook
import './Admin.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc 
} from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const FEATURES = [
    { id: 'access', label: 'Dashboard Login' },
    { id: 'timer', label: 'Live Timer' },
    { id: 'settings', label: 'Project Info' },
    { id: 'workers', label: 'Worker DB' },
    { id: 'fleet', label: 'Fleet Mgmt' },
    { id: 'queue', label: 'Project Queue' },
    { id: 'finance', label: 'Finance Input' },
    { id: 'bonuses', label: 'Bonus Manager' },
    { id: 'search', label: 'Project Archive' },
    { id: 'summary', label: 'Past Prod Summary' },
    { id: 'admin', label: 'Admin Panel' }
];

// 2. Remove props, use internal navigation
const Admin = () => {
    const navigate = useNavigate(); // 3. Initialize Hook

    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [rolesConfig, setRolesConfig] = useState({});
    const [currentUserEmail, setCurrentUserEmail] = useState('');
    const [currentUserRole, setCurrentUserRole] = useState('');
    const [globalSettings, setGlobalSettings] = useState({ allowEmailLogin: false });
    
    // Form States
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserRole, setNewUserRole] = useState('viewer');
    const [newUserPassAccess, setNewUserPassAccess] = useState(false);
    const [newRoleName, setNewRoleName] = useState('');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUserEmail(user.email.toLowerCase());
                loadUserData(user, async () => {
                    await checkAccess(user);
                });
            } else {
                navigate('/'); // Redirect to home/login
            }
        });
        return () => unsubscribe();
    }, []);

    const checkAccess = async (user) => {
        const uSnap = await getDoc(doc(db, "users", user.email.toLowerCase()));
        if (uSnap.exists()) {
            const r = uSnap.data().role;
            setCurrentUserRole(r);
            await fetchRolesConfig(); 
            const configSnap = await getDoc(doc(db, "config", "roles"));
            if(configSnap.exists()) {
                const config = configSnap.data();
                setRolesConfig(config);
                
                let hasAccess = false;
                if(r === 'admin') hasAccess = true;
                else if (config[r] && (config[r]['admin_view'] || config[r]['admin_edit'])) hasAccess = true;

                if (!hasAccess) {
                    alert("Access Denied.");
                    navigate('/'); // Go back if denied
                    return;
                }
                
                fetchUsers();
                fetchGlobalSettings();
            }
        }
    };

    // --- DATA FETCHING ---
    const fetchRolesConfig = async () => {
        const snap = await getDoc(doc(db, "config", "roles"));
        if (snap.exists()) setRolesConfig(snap.data());
    };

    const fetchUsers = async () => {
        const snap = await getDocs(collection(db, "users"));
        const list = [];
        snap.forEach(d => list.push(d.data()));
        setUsers(list);
    };

    const fetchGlobalSettings = async () => {
        const snap = await getDoc(doc(db, "config", "global"));
        if (snap.exists()) setGlobalSettings(snap.data());
    };

    // --- ACTIONS: USERS ---
    const handleAddUser = async () => {
        if (!newUserEmail) return alert("Enter email");
        const email = newUserEmail.toLowerCase().trim();
        await setDoc(doc(db, "users", email), {
            email: email,
            role: newUserRole,
            allowPassword: newUserPassAccess,
            passwordSet: false
        });
        setNewUserEmail('');
        fetchUsers();
    };

    const handleUpdateUser = async (email, field, value) => {
        await updateDoc(doc(db, "users", email), { [field]: value });
        fetchUsers();
    };

    const handleDeleteUser = async (email) => {
        if (window.confirm(`Remove access for ${email}?`)) {
            await deleteDoc(doc(db, "users", email));
            fetchUsers();
        }
    };

    const handleToggleGlobalLogin = async (val) => {
        const newState = { ...globalSettings, allowEmailLogin: val };
        setGlobalSettings(newState);
        await setDoc(doc(db, "config", "global"), newState, { merge: true });
    };

    // --- ACTIONS: ROLES ---
    const handleAddRole = () => {
        const roleKey = newRoleName.trim().toLowerCase().replace(/\s+/g, '_');
        if (!roleKey) return;
        if (rolesConfig[roleKey]) return alert("Role exists");

        const newConfig = { ...rolesConfig, [roleKey]: { access_view: true } };
        setRolesConfig(newConfig);
        setNewRoleName('');
    };

    const handleDeleteRole = (roleKey) => {
        if (window.confirm(`Delete role ${roleKey}?`)) {
            const newConfig = { ...rolesConfig };
            delete newConfig[roleKey];
            setRolesConfig(newConfig);
        }
    };

    const handleSetPermission = (roleKey, featureId, level) => {
        const newConfig = { ...rolesConfig };
        const viewKey = featureId + '_view';
        const editKey = featureId + '_edit';

        newConfig[roleKey][viewKey] = false;
        newConfig[roleKey][editKey] = false;

        if (level === 'view') newConfig[roleKey][viewKey] = true;
        if (level === 'edit') {
            newConfig[roleKey][viewKey] = true;
            newConfig[roleKey][editKey] = true;
        }
        setRolesConfig(newConfig);
    };

    const saveAllRoles = async () => {
        await setDoc(doc(db, "config", "roles"), rolesConfig);
        alert("Roles Configuration Saved!");
    };

    const handleLogout = () => {
        signOut(auth).then(() => window.location.href = '/');
    };

    const sortedRoles = Object.keys(rolesConfig).sort((a, b) => 
        a === 'admin' ? -1 : b === 'admin' ? 1 : a.localeCompare(b)
    );

    return (
        <div className="admin-page-wrapper" style={{background:'#f4f7f6', minHeight:'100vh'}}>
            <div className="admin-top-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    {/* 4. BUTTON FIXED: Uses navigate('/') */}
                    <button 
                        onClick={() => navigate('/')} 
                        style={{background:'none', border:'none', fontSize:'16px', fontWeight:'bold', cursor:'pointer', color:'#2c3e50'}}
                    >
                        &larr; Dashboard
                    </button>
                </div>
                <button onClick={handleLogout} className="btn-red-text">Sign Out</button>
            </div>

            <div className="admin-container">
                <div className="admin-tabs">
                    <button 
                        className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`} 
                        onClick={() => setActiveTab('users')}
                    >
                        User Management
                    </button>
                    <button 
                        className={`tab-btn ${activeTab === 'roles' ? 'active' : ''}`} 
                        onClick={() => setActiveTab('roles')}
                    >
                        Role Configuration
                    </button>
                </div>

                {activeTab === 'users' && (
                    <>
                        <div className="admin-card">
                            <div style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '20px' }}>User Access Control</div>
                            <div style={{ background: '#f8f9fa', padding: '20px', borderRadius: '8px', display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'center', flexWrap:'wrap' }}>
                                <input 
                                    type="text" 
                                    className="admin-input"
                                    placeholder="Email Address" 
                                    value={newUserEmail}
                                    onChange={(e) => setNewUserEmail(e.target.value)}
                                    style={{ flex: 2 }} 
                                />
                                <select 
                                    className="admin-input"
                                    value={newUserRole}
                                    onChange={(e) => setNewUserRole(e.target.value)}
                                    style={{ flex: 1 }}
                                >
                                    {sortedRoles.map(r => (
                                        <option key={r} value={r}>{r.toUpperCase()}</option>
                                    ))}
                                </select>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
                                    <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Pwd Login:</span>
                                    <label className="switch">
                                        <input 
                                            type="checkbox" 
                                            checked={newUserPassAccess}
                                            onChange={(e) => setNewUserPassAccess(e.target.checked)}
                                        />
                                        <span className="slider"></span>
                                    </label>
                                </div>
                                <button className="btn-green" onClick={handleAddUser}>Authorize</button>
                            </div>

                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>Email</th>
                                        <th>Role</th>
                                        <th style={{textAlign:'center'}}>Pwd Access</th>
                                        <th style={{textAlign:'right'}}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.email}>
                                            <td>{u.email} {u.email === currentUserEmail ? '(You)' : ''}</td>
                                            <td>
                                                <select 
                                                    value={u.role} 
                                                    onChange={(e) => handleUpdateUser(u.email, 'role', e.target.value)}
                                                    className="admin-input"
                                                    style={{ padding: '5px' }}
                                                    disabled={u.email === currentUserEmail}
                                                >
                                                    {sortedRoles.map(r => (
                                                        <option key={r} value={r}>{r.toUpperCase()}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td style={{textAlign:'center'}}>
                                                <label className="switch">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={u.allowPassword || false} 
                                                        onChange={(e) => handleUpdateUser(u.email, 'allowPassword', e.target.checked)}
                                                        disabled={u.email === currentUserEmail}
                                                    />
                                                    <span className="slider"></span>
                                                </label>
                                            </td>
                                            <td style={{textAlign:'right'}}>
                                                {u.email !== currentUserEmail && (
                                                    <button className="btn-red-outline" onClick={() => handleDeleteUser(u.email)}>Remove</button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {activeTab === 'roles' && (
                    <div className="admin-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ margin: 0 }}>Permissions Matrix</h2>
                            <button className="btn-green" onClick={saveAllRoles}>Save All Changes</button>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', background: '#e8f6f3', padding: '15px', borderRadius: '8px', alignItems: 'center' }}>
                            <span className="material-icons" style={{ color: '#27ae60' }}>add_circle</span>
                            <input 
                                type="text" 
                                className="admin-input"
                                placeholder="New Role Name (e.g. Intern)" 
                                style={{ flex: 1 }}
                                value={newRoleName}
                                onChange={(e) => setNewRoleName(e.target.value)}
                            />
                            <button className="btn-green" style={{ padding: '8px 15px' }} onClick={handleAddRole}>Create Role</button>
                        </div>

                        <div className="role-grid">
                            {sortedRoles.map(role => {
                                const perms = rolesConfig[role] || {};
                                const isLocked = perms._locked === true;
                                
                                return (
                                    <div key={role} className={`role-card ${role === 'admin' ? 'admin-role' : ''}`}>
                                        <div className="role-header">
                                            <div className="role-name">{role.replace(/_/g, ' ')}</div>
                                            {!isLocked && (
                                                <span 
                                                    className="material-icons" 
                                                    style={{ color: '#e74c3c', cursor: 'pointer' }} 
                                                    onClick={() => handleDeleteRole(role)}
                                                >
                                                    delete
                                                </span>
                                            )}
                                        </div>

                                        {isLocked ? (
                                            <div style={{ textAlign: 'center', color: '#888', fontSize: '13px', padding: '20px' }}>
                                                <i>Full System Access (Locked)</i>
                                            </div>
                                        ) : (
                                            FEATURES.map(f => {
                                                const vKey = f.id + '_view';
                                                const eKey = f.id + '_edit';
                                                
                                                let level = 'none';
                                                if (perms[eKey]) level = 'edit';
                                                else if (perms[vKey]) level = 'view';

                                                return (
                                                    <div key={f.id} className="perm-row">
                                                        <div className="perm-label">{f.label}</div>
                                                        <div className="level-select">
                                                            <div 
                                                                className={`level-opt ${level === 'none' ? 'active' : ''}`}
                                                                onClick={() => handleSetPermission(role, f.id, 'none')}
                                                            >None</div>
                                                            <div 
                                                                className={`level-opt view ${level === 'view' ? 'active' : ''}`}
                                                                onClick={() => handleSetPermission(role, f.id, 'view')}
                                                            >View</div>
                                                            <div 
                                                                className={`level-opt edit ${level === 'edit' ? 'active' : ''}`}
                                                                onClick={() => handleSetPermission(role, f.id, 'edit')}
                                                            >Edit</div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Admin;