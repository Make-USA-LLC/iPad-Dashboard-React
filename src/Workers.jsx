import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './Workers.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, onSnapshot, setDoc, deleteDoc, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const Workers = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [canEdit, setCanEdit] = useState(false);
    const [hasAccess, setHasAccess] = useState(false);
    
    // Data State
    const [allWorkers, setAllWorkers] = useState([]);
    const [filteredWorkers, setFilteredWorkers] = useState([]);
    const [searchText, setSearchText] = useState('');

    // Form State
    const [newId, setNewId] = useState('');
    const [newName, setNewName] = useState('');
    const idInputRef = useRef(null);

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
                if (rc['workers_view']) view = true;
                if (rc['workers_edit']) edit = true;
            }
        }

        if (view) {
            setHasAccess(true);
            setCanEdit(edit);
            startListener();
        } else {
            denyAccess();
        }
    };

    const denyAccess = () => {
        setLoading(false);
    };

    const startListener = () => {
        const unsub = onSnapshot(collection(db, "workers"), (snapshot) => {
            const list = [];
            snapshot.forEach(doc => {
                list.push({ id: doc.id, ...doc.data() });
            });
            // Sort Alphabetically
            list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
            setAllWorkers(list);
            // Apply filter immediately if search exists, otherwise show all
            setFilteredWorkers(prev => searchText ? prev : list); 
            setLoading(false);
        });
        return () => unsub(); // Cleanup on unmount
    };

    // Filter Logic
    useEffect(() => {
        const term = searchText.toLowerCase();
        const filtered = allWorkers.filter(w => 
            w.id.toLowerCase().includes(term) || 
            (w.name || '').toLowerCase().includes(term)
        );
        setFilteredWorkers(filtered);
    }, [searchText, allWorkers]);

    const handleAddWorker = async () => {
        if (!canEdit) return alert("Access Denied: View Only");
        
        const id = newId.trim();
        const name = newName.trim();

        if (!id || !name) return alert("Please enter both Card ID and Name.");

        try {
            await setDoc(doc(db, "workers", id), { name: name });
            setNewId('');
            setNewName('');
            idInputRef.current.focus(); // Focus back for rapid entry
        } catch (e) {
            alert("Error adding worker: " + e.message);
        }
    };

    const handleDelete = async (id) => {
        if (!canEdit) return alert("Access Denied: View Only");
        if (window.confirm(`Are you sure you want to delete worker ID: ${id}?`)) {
            await deleteDoc(doc(db, "workers", id));
        }
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Database...</div>;
    if (!hasAccess) return <div className="wm-denied">Access Denied: You do not have permission to view workers.</div>;

    return (
        <div className="wm-wrapper">
            <div className="wm-top-bar">
                <button onClick={() => navigate('/')} className="btn-link">
                    <span className="material-icons">arrow_back</span> Dashboard
                </button>
                <button onClick={handleLogout} className="btn-link" style={{color:'#e74c3c'}}>Sign Out</button>
            </div>

            <div className="wm-container">
                <div className="wm-card">
                    
                    {canEdit && (
                        <div className="wm-add-box">
                            {/* Card ID - Small Group */}
                            <div className="wm-group-small">
                                <label className="wm-input-label">RFID Card ID</label>
                                <input 
                                    ref={idInputRef}
                                    type="text" 
                                    className="wm-input" 
                                    value={newId}
                                    onChange={e => setNewId(e.target.value)}
                                    placeholder="Scan/Type ID"
                                />
                            </div>
                            
                            {/* Name - Large Group (Fills space) */}
                            <div className="wm-group-large">
                                <label className="wm-input-label">Employee Name</label>
                                <input 
                                    type="text" 
                                    className="wm-input" 
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder="First Last" 
                                    onKeyDown={e => e.key === 'Enter' && handleAddWorker()}
                                />
                            </div>
                            
                            {/* Button - Auto Width */}
                            <button className="btn-green" onClick={handleAddWorker}>Add Worker</button>
                        </div>
                    )}

                    <div className="wm-header-row">
                        <div style={{display:'flex', alignItems:'center'}}>
                            <div className="wm-header-title">Worker Database</div>
                            <span className="wm-counter-badge">{filteredWorkers.length}</span>
                        </div>
                        <input 
                            type="text" 
                            className="wm-search-bar" 
                            placeholder="Search workers..." 
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                        />
                    </div>

                    <table className="wm-table">
                        <thead>
                            <tr>
                                <th>Card ID</th>
                                <th>Employee Name</th>
                                <th style={{textAlign:'right'}}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredWorkers.length === 0 ? (
                                <tr><td colSpan="3" style={{textAlign:'center', padding:'30px', color:'#999'}}>No workers found.</td></tr>
                            ) : (
                                filteredWorkers.map(w => (
                                    <tr key={w.id}>
                                        <td><span className="wm-id-badge">{w.id}</span></td>
                                        <td style={{fontWeight:500}}>{w.name}</td>
                                        <td style={{textAlign:'right'}}>
                                            {canEdit && (
                                                <button className="btn-del" onClick={() => handleDelete(w.id)}>Delete</button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Workers;