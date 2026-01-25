import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Dashboard from './Dashboard';
import Login from './Login';
import Admin from './Admin';
import NotFound from './NotFound';
import AgentManagement from './AgentManagement';
import Bonuses from './Bonuses';
import BonusReports from './BonusReports';
import EmployeePortal from './EmployeePortal';
import Commisions from './Commisions';
import AgentPortal from './AgentPortal';
import Kiosk from './Kiosk';
import Logout from './Logout';
import ManualIngest from './manual_ingest';
import ProductionInput from './ProductionInput';
import ProjectOptions from './ProjectOptions';
import FinanceInput from './FinanceInput';
import FinanceSetup from './FinanceSetup';
import FinancialReport from './FinancialReport';
import IpadControl from './iPad';
import ProjectSearch from './ProjectSearch';
import ArchiveUpload from './ArchiveUpload';
import StaffManagement from './StaffManagement';
import ProjectSummary from './ProjectSummary';
import UpcomingProjects from './UpcomingProjects';
import Workers from './Workers';
import { auth, onAuthStateChanged, db, doc, getDoc, setDoc, signOut } from './firebase_config.jsx';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // 1. Handle Subdomain Redirects
  useEffect(() => {
    const host = window.location.hostname;
    if (host.includes("portal.makeusa") || host.includes("portal.makeit")) {
       window.location.replace("https://makeusa.us/employee.html");
    } else if (host.includes("agent") || host.includes("commission")) {
       window.location.replace("https://makeusa.us/agent_portal.html");
    }
  }, []);

  // 2. Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        await checkAccess(currentUser);
      } else {
        setUser(null);
        setLoading(false);
        // Only redirect to login if we are not already there
        if (window.location.pathname !== '/') navigate('/');
      }
    });
    return () => unsubscribe();
  }, []);

  const checkAccess = async (currentUser) => {
    const emailKey = currentUser.email.toLowerCase();

    // Admin Bypass
    if (emailKey === "daniel.s@makeit.buzz") {
      await setDoc(doc(db, "users", emailKey), { role: "admin", email: emailKey, allowPassword: true }, { merge: true });
      setUser(currentUser);
      setLoading(false);
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, "users", emailKey));
      if (!userDoc.exists()) {
        alert("Access Denied: User not found.");
        await signOut(auth);
        setUser(null);
      } else {
        const data = userDoc.data();
        const isGoogle = currentUser.providerData.some(p => p.providerId === 'google.com');
        if (!isGoogle && data.allowPassword !== true && data.role !== 'admin') {
            alert("Access Denied: Please sign in with Google.");
            await signOut(auth);
            setUser(null);
        } else {
            setUser(currentUser);
        }
      }
    } catch (err) {
      console.error("Login Check Error", err);
      setUser(null);
    }
    setLoading(false);
  };

  if (loading) return <div style={{color:'white', background:'#1e3c72', height:'100vh', display:'flex', justifyContent:'center', alignItems:'center'}}>Loading System...</div>;

  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/agent-management" element={<AgentManagement />} />
      <Route path="/bonuses" element={<Bonuses />} />
      <Route path="/bonus-reports" element={<BonusReports />} />
      <Route path="/employee-portal" element={<EmployeePortal />} />
      <Route path="/EmployeePortal" element={<EmployeePortal />} />
      <Route path="/commisions" element={<Commisions />} /> 
      <Route path="/AgentPortal" element={<AgentPortal />} />
      <Route path="/agent-portal" element={<AgentPortal />} />
      <Route path="/kiosk" element={<Kiosk />} />
<Route path="/logout" element={<Logout />} />
<Route path="/manual-ingest" element={<ManualIngest />} />
<Route path="/manual_ingest" element={<ManualIngest />} />
<Route path="/production-input" element={<ProductionInput />} />
<Route path="/ProjectOptions" element={<ProjectOptions />} />
<Route path="/finance-input" element={<FinanceInput />} />
<Route path="/financial-report" element={<FinancialReport />} />
<Route path="/FinancialReport" element={<FinancialReport />} />
<Route path="/FinanceSetup" element={<FinanceSetup />} />
<Route path="/iPad/:id" element={<IpadControl />} />
<Route path="/ipad-control/:id" element={<IpadControl />} />
<Route path="/project-search" element={<ProjectSearch />} />
<Route path="/upload" element={<ArchiveUpload />} />
<Route path="/staff-management" element={<StaffManagement />} />
<Route path="/StaffManagement" element={<StaffManagement />} />
<Route path="/project-summary" element={<ProjectSummary />} />
<Route path="/ProjectSummary" element={<ProjectSummary />} />
<Route path="/upcoming-projects" element={<UpcomingProjects />} />
<Route path="/UpcomingProjects" element={<UpcomingProjects />} />
<Route path="/workers" element={<Workers />} />



      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;