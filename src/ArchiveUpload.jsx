import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import './ArchiveUpload.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, writeBatch, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const ArchiveUpload = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [canEdit, setCanEdit] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [statusMsg, setStatusMsg] = useState('');
    const [statusType, setStatusType] = useState(''); // 'success' or 'error'
    const [isUploading, setIsUploading] = useState(false);
    
    const fileInputRef = useRef(null);

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
        let allowed = false;
        if (role === 'admin') allowed = true;
        else if (rolesSnap.exists()) {
            const rc = rolesSnap.data()[role];
            // Check 'finance_edit' OR 'admin_edit'
            if (rc && (rc['finance_edit'] || rc['admin_edit'])) allowed = true;
        }

        if (allowed) {
            setCanEdit(true);
        }
        setLoading(false);
    };

    const denyAccess = () => {
        setLoading(false);
        setCanEdit(false);
    };

    const handleFileChange = (e) => {
        if (e.target.files.length > 0) {
            setSelectedFile(e.target.files[0]);
            setStatusMsg('');
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;
        setIsUploading(true);
        setStatusMsg("Reading file...");
        setStatusType('');

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                if (jsonData.length === 0) throw new Error("Excel file is empty.");

                setStatusMsg(`Found ${jsonData.length} rows. Starting upload...`);

                // BATCH UPLOAD LOGIC
                const batchSize = 450; 
                let batch = writeBatch(db);
                let count = 0;
                let totalUploaded = 0;

                for (const row of jsonData) {
                    // Add metadata
                    row.uploadedBy = auth.currentUser.email;
                    row.uploadedAt = new Date().toISOString();

                    const docRef = doc(collection(db, "archive"));
                    batch.set(docRef, row);
                    
                    count++;
                    totalUploaded++;

                    if (count >= batchSize) {
                        setStatusMsg(`Uploading... (${totalUploaded}/${jsonData.length})`);
                        await batch.commit();
                        batch = writeBatch(db);
                        count = 0;
                    }
                }

                if (count > 0) await batch.commit();

                setStatusMsg("Success! All data moved to Archive.");
                setStatusType('success');
                
                // Reset
                setTimeout(() => {
                    setSelectedFile(null);
                    if(fileInputRef.current) fileInputRef.current.value = "";
                    setStatusMsg("");
                    setStatusType("");
                }, 3000);

            } catch (error) {
                console.error(error);
                setStatusMsg("Error: " + error.message);
                setStatusType('error');
            }
            setIsUploading(false);
        };
        reader.readAsArrayBuffer(selectedFile);
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading...</div>;

    return (
        <div className="au-wrapper">
            <div className="au-top-bar">
                <div style={{display:'flex', alignItems:'center', gap:'20px'}}>
                    <button onClick={() => navigate('/')} className="btn-link">&larr; Dashboard</button>
                    <button onClick={() => navigate('/finance-setup')} className="btn-blue-outline">Finance Setup</button>
                </div>
                <button onClick={handleLogout} className="btn-link" style={{color:'#e74c3c'}}>Sign Out</button>
            </div>

            <div className="au-container">
                <div className="au-card">
                    <h2>Archive Excel Upload</h2>
                    <p>Select an .xlsx file to move into the <b>Archive</b> database.<br/>
                    <small>Requires 'Finance Input' Edit Permissions.</small></p>

                    {canEdit ? (
                        <div id="upload-ui">
                            <div 
                                className="au-upload-zone" 
                                onClick={() => fileInputRef.current.click()}
                            >
                                <span className="au-custom-file-btn">Choose Excel File</span>
                                <span className="au-filename">{selectedFile ? selectedFile.name : "No file selected"}</span>
                                <input 
                                    type="file" 
                                    ref={fileInputRef}
                                    className="au-file-input" 
                                    accept=".xlsx, .xls"
                                    onChange={handleFileChange}
                                />
                            </div>

                            <button 
                                className="btn-green" 
                                disabled={!selectedFile || isUploading} 
                                onClick={handleUpload}
                            >
                                {isUploading ? "Uploading..." : "Start Batch Upload"}
                            </button>
                        </div>
                    ) : (
                        <div className="au-locked-ui">
                            <span className="material-icons" style={{fontSize:'32px'}}>lock</span><br/>
                            <strong>Access Denied</strong><br/>
                            You do not have the permissions required to view this page.
                        </div>
                    )}

                    {statusMsg && (
                        <div className={`au-status-msg ${statusType === 'success' ? 'au-status-success' : statusType === 'error' ? 'au-status-error' : ''}`}>
                            {statusMsg}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ArchiveUpload;