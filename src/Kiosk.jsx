import React, { useState, useEffect } from 'react';
import './Kiosk.css';
import { db, auth } from './firebase_config.jsx';
import { collection, onSnapshot } from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';

const Kiosk = () => {
    const [ipads, setIpads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now());

    // 1. Auto-Login & Data Listener
    useEffect(() => {
        const kioskEmail = import.meta.env.VITE_KIOSK_EMAIL;
        const kioskPass = import.meta.env.VITE_KIOSK_PASS;

        if (!kioskEmail || !kioskPass) {
            setError("Kiosk credentials missing in .env file");
            return;
        }

        signInWithEmailAndPassword(auth, kioskEmail, kioskPass)
            .then(() => {
                // Login Success -> Start Listening
                const unsubscribe = onSnapshot(collection(db, "ipads"), (snapshot) => {
                    let list = [];
                    snapshot.forEach(doc => {
                        list.push({ id: doc.id, ...doc.data() });
                    });

                    // Sort: Running (3) -> Paused (2) -> Idle (1)
                    list.sort((a, b) => {
                        const getScore = (i) => {
                            const hasProject = i.secondsRemaining !== 0; 
                            if (hasProject && !i.isPaused) return 3; 
                            if (hasProject && i.isPaused) return 2;  
                            return 1; 
                        };
                        return getScore(b) - getScore(a);
                    });

                    setIpads(list);
                    setLoading(false);
                });

                return () => unsubscribe();
            })
            .catch((err) => {
                console.error("Kiosk Login Error:", err);
                setError("Login Failed: " + err.message);
                // Auto-refresh in 10s if login fails (network blip)
                setTimeout(() => window.location.reload(), 10000);
            });
    }, []);

    // 2. Timer Tick (Updates every second)
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    // 3. Render Helper
    const renderTimer = (ipad) => {
        let seconds = ipad.secondsRemaining || 0;
        
        // Calculate burn if live
        if (!ipad.isPaused && ipad.lastUpdateTime && ipad.activeWorkers?.length > 0) {
            const lastUpdate = ipad.lastUpdateTime.seconds * 1000;
            const elapsed = Math.floor((now - lastUpdate) / 1000);
            seconds = seconds - (elapsed * ipad.activeWorkers.length);
        }

        const isNeg = seconds < 0;
        const absSec = Math.abs(seconds);
        const h = Math.floor(absSec / 3600);
        const m = Math.floor((absSec % 3600) / 60);
        const s = Math.floor(absSec % 60);
        
        const fmt = (n) => n.toString().padStart(2, '0');
        return `${isNeg ? '-' : ''}${h}:${fmt(m)}:${fmt(s)}`;
    };

    if (error) return <div className="kiosk-loading" style={{color:'#e74c3c'}}>{error}</div>;
    if (loading) return <div className="kiosk-loading">Initializing Kiosk...</div>;

    return (
        <div className="kiosk-wrapper">
            <div className="kiosk-grid">
                {ipads.map(ipad => {
                    const isActive = ipad.secondsRemaining !== 0;
                    const isPaused = ipad.isPaused === true;
                    
                    let statusText = 'IDLE';
                    let statusClass = 'k-st-idle';
                    let timerClass = 'k-timer-idle';

                    if (isActive) {
                        if (isPaused) {
                            statusText = 'PAUSED';
                            statusClass = 'k-st-paused';
                            timerClass = 'k-timer-paused';
                        } else {
                            statusText = 'RUNNING';
                            statusClass = 'k-st-active';
                            timerClass = ''; // Default Green
                        }
                    }

                    return (
                        <div key={ipad.id} className="kiosk-card">
                            <div className="k-card-header">
                                <span className="k-card-id">{ipad.id}</span>
                                <span className={`k-card-status ${statusClass}`}>{statusText}</span>
                            </div>
                            <div className="k-card-body">
                                <div className="k-card-project">{ipad.projectName || 'No Project'}</div>
                                <div className="k-card-meta">
                                    {ipad.companyName || ''} • Workers: {ipad.activeWorkers?.length || 0}
                                </div>
                            </div>
                            <div className={`k-card-timer ${timerClass}`}>
                                {renderTimer(ipad)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Kiosk;