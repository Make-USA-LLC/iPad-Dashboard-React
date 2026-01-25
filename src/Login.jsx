import React, { useState } from 'react';
import { 
  auth, 
  provider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail 
} from './firebase_config.jsx';

const Login = () => {
  const [view, setView] = useState('login'); // 'login' or 'register'
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Styles (Ported from your HTML)
  const styles = {
    container: {
      fontFamily: "'Segoe UI', sans-serif",
      background: 'linear-gradient(135deg, #1e3c72 0%, #2a5299 100%)',
      height: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      margin: 0
    },
    card: {
      background: 'white',
      width: '380px',
      padding: '40px',
      borderRadius: '16px',
      boxShadow: '0 15px 35px rgba(0,0,0,0.3)',
      textAlign: 'center'
    },
    logoText: {
      fontSize: '26px',
      fontWeight: '800',
      color: '#1e3c72',
      marginBottom: '5px',
      textTransform: 'uppercase'
    },
    input: {
      width: '100%',
      padding: '12px',
      border: '2px solid #eef2f7',
      borderRadius: '8px',
      marginBottom: '10px',
      boxSizing: 'border-box'
    },
    btnPrimary: {
      width: '100%',
      padding: '12px',
      border: 'none',
      borderRadius: '8px',
      fontSize: '15px',
      fontWeight: 'bold',
      cursor: 'pointer',
      background: '#1e3c72',
      color: 'white',
      marginTop: '5px'
    },
    btnGoogle: {
      width: '100%',
      padding: '12px',
      border: '2px solid #eee',
      borderRadius: '8px',
      fontSize: '15px',
      fontWeight: 'bold',
      cursor: 'pointer',
      background: 'white',
      color: '#555',
      marginBottom: '15px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px'
    },
    link: {
      color: '#3498db',
      cursor: 'pointer',
      textDecoration: 'underline',
      fontSize: '13px'
    },
    divider: {
        display: 'flex', alignItems: 'center', margin: '20px 0', color: '#bbb', fontSize: '12px'
    }
  };

  const handleGoogleLogin = async () => {
    try { await signInWithPopup(auth, provider); } 
    catch (e) { setError(e.message); }
  };

  const handleEmailLogin = async () => {
    try { await signInWithEmailAndPassword(auth, email, password); } 
    catch (e) { setError(e.message); }
  };

  const handleRegister = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      alert("Account created! Waiting for approval/login...");
      setView('login');
    } catch (e) { setError("Error: " + e.message); }
  };

  const handleResetPassword = async () => {
    const resetEmail = prompt("Enter email:");
    if (resetEmail) {
      try {
        await sendPasswordResetEmail(auth, resetEmail.toLowerCase());
        alert("Sent!");
      } catch (e) { alert(e.message); }
    }
  };

  return (
    <div style={styles.container}>
      {view === 'login' ? (
        <div style={styles.card}>
          <div style={styles.logoText}>Make USA</div>
          <div style={{marginBottom:'30px', color:'#7f8c8d'}}>iPad Command</div>
          
          <button style={styles.btnGoogle} onClick={handleGoogleLogin}>
            <span className="material-icons">login</span> Sign in with Google
          </button>
          
          <div style={styles.divider}>
             <span style={{flex:1, height:'1px', background:'#eee'}}></span>
             <span style={{padding:'0 10px'}}>OR</span>
             <span style={{flex:1, height:'1px', background:'#eee'}}></span>
          </div>

          {!showEmailForm ? (
            <a style={styles.link} onClick={() => setShowEmailForm(true)}>Log in with Email</a>
          ) : (
            <div>
              <input 
                type="email" 
                style={styles.input} 
                placeholder="Email Address" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input 
                type="password" 
                style={styles.input} 
                placeholder="Password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button style={styles.btnPrimary} onClick={handleEmailLogin}>Log In</button>
              
              <div style={{marginTop:'20px', fontSize:'13px', color:'#666'}}>
                <a style={styles.link} onClick={handleResetPassword}>Forgot?</a> | <a style={styles.link} onClick={() => { setView('register'); setError(''); }}>Create Account</a>
              </div>
            </div>
          )}
          {error && <div style={{color:'red', fontSize:'13px', marginTop:'15px'}}>{error}</div>}
        </div>
      ) : (
        // REGISTER VIEW
        <div style={styles.card}>
            <div style={styles.logoText}>New Account</div>
            <div style={{marginBottom:'15px', color:'#7f8c8d', fontSize:'13px'}}>Email must be pre-approved by Admin</div>
            
            <input 
                type="email" 
                style={styles.input} 
                placeholder="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
            />
            <input 
                type="password" 
                style={styles.input} 
                placeholder="Choose Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            <button style={{...styles.btnPrimary, background:'#27ae60'}} onClick={handleRegister}>Create Account</button>
            
            <div style={{marginTop:'20px', fontSize:'13px', color:'#666'}}>
                <a style={styles.link} onClick={() => { setView('login'); setError(''); }}>Back to Login</a>
            </div>
            {error && <div style={{color:'red', fontSize:'13px', marginTop:'15px'}}>{error}</div>}
        </div>
      )}
    </div>
  );
};

export default Login;