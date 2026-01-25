import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './NotFound.css';

const NotFound = () => {
    const navigate = useNavigate();
    const [seconds, setSeconds] = useState(4);

    useEffect(() => {
        // Countdown Timer Logic
        const interval = setInterval(() => {
            setSeconds((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    navigate('/'); // Redirect to Dashboard
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        // Cleanup on unmount (prevents memory leaks)
        return () => clearInterval(interval);
    }, [navigate]);

    return (
        <div className="not-found-container">
            <div className="popup-overlay">
                <div className="popup-card">
                    <div className="icon-circle">
                        <span className="material-icons" style={{fontSize: '32px'}}>error_outline</span>
                    </div>
                    <h1>Page Not Found</h1>
                    <p>We couldn't find the page you were looking for. You will be redirected to the dashboard shortly.</p>
                    
                    <button onClick={() => navigate('/')} className="btn-primary">
                        Go to Dashboard Now
                    </button>
                    
                    <div className="timer-text">
                        Redirecting in <span id="countdown">{seconds}</span> seconds...
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NotFound;