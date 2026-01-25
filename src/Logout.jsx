import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from './firebase_config.jsx';
import { signOut } from 'firebase/auth';

const Logout = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const performLogout = async () => {
            try {
                await signOut(auth);
                // Redirect to Login/Home after successful sign out
                navigate('/'); 
            } catch (error) {
                console.error("Error signing out:", error);
                // Redirect anyway if there's an error (force exit)
                navigate('/');
            }
        };

        performLogout();
    }, [navigate]);

    return (
        <div style={{
            fontFamily: 'Segoe UI, sans-serif',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            background: '#f4f7f6',
            color: '#555'
        }}>
            <h3>Signing you out...</h3>
        </div>
    );
};

export default Logout;