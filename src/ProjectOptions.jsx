import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './ProjectOptions.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { doc, getDoc, updateDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const DropdownManager = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [canEdit, setCanEdit] = useState(false);
    
    // Data State
    const [data, setData] = useState({
        companies: [],
        categories: [],
        sizes: []
    });

    // Inputs State
    const [newCompany, setNewCompany] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [newSize, setNewSize] = useState('');

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
                if (rc['queue_view']) view = true;
                if (rc['queue_edit']) edit = true;
            }
        }

        if (view) {
            setCanEdit(edit);
            startListener();
        } else {
            denyAccess();
        }
    };

    const denyAccess = () => {
        alert("Access Denied");
        navigate('/');
    };

    const startListener = () => {
        const configRef = doc(db, "config", "project_options");
        // Real-time listener
        onSnapshot(configRef, (snap) => {
            if (snap.exists()) {
                const d = snap.data();
                setData({
                    companies: d.companies || [],
                    categories: d.categories || [],
                    sizes: d.sizes || []
                });
            } else {
                // Init if empty
                setDoc(configRef, { companies: [], categories: [], sizes: [] });
            }
            setLoading(false);
        });
    };

    // --- ACTIONS ---
    const addItem = async (type, val, setter) => {
        if (!canEdit) return alert("Read Only Access");
        if (!val.trim()) return;

        const configRef = doc(db, "config", "project_options");
        const list = [...data[type]];
        
        if (!list.includes(val.trim())) {
            list.push(val.trim());
            list.sort();
            await updateDoc(configRef, { [type]: list });
            setter(''); // Clear input
        }
    };

    const deleteItem = async (type, index) => {
        if (!canEdit) return alert("Read Only Access");
        if(!window.confirm("Delete item?")) return;

        const configRef = doc(db, "config", "project_options");
        const list = [...data[type]];
        list.splice(index, 1);
        await updateDoc(configRef, { [type]: list });
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Options...</div>;

    // Helper to render a card
    const RenderCard = ({ title, list, type, inputVal, setInput }) => (
        <div className={`dm-card ${!canEdit ? 'read-only' : ''}`}>
            <h2>{title}</h2>
            <div className="dm-input-group">
                <input 
                    type="text" 
                    className="dm-input" 
                    placeholder={`Add ${title}...`}
                    value={inputVal}
                    onChange={e => setInput(e.target.value)}
                />
                <button className="btn btn-green" onClick={() => addItem(type, inputVal, setInput)}>Add</button>
            </div>
            <ul className="dm-list">
                {list.length === 0 && <li className="dm-empty">No items defined.</li>}
                {list.map((item, i) => (
                    <li key={i}>
                        <span>{item}</span>
                        {canEdit && (
                            <button className="btn-red-small" onClick={() => deleteItem(type, i)}>Delete</button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );

    return (
        <div className="dm-wrapper">
            <div className="dm-top-bar">
                <button onClick={() => navigate('/')} className="btn-text">&larr; Dashboard</button>
                <div style={{fontWeight:'bold'}}>Dropdown Options Manager</div>
                <div /> {/* Spacer for layout balance */}
            </div>

            <div className="dm-container">
                <div className="dm-split-view">
                    <RenderCard 
                        title="Companies" 
                        list={data.companies} 
                        type="companies" 
                        inputVal={newCompany} 
                        setInput={setNewCompany} 
                    />
                    
                    <RenderCard 
                        title="Categories" 
                        list={data.categories} 
                        type="categories" 
                        inputVal={newCategory} 
                        setInput={setNewCategory} 
                    />
                    
                    <RenderCard 
                        title="Sizes" 
                        list={data.sizes} 
                        type="sizes" 
                        inputVal={newSize} 
                        setInput={setNewSize} 
                    />
                </div>
            </div>
        </div>
    );
};

export default DropdownManager;