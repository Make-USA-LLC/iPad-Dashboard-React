import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
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
import AgentReports from './AgentReports';
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
  const location = useLocation();

  // 1. DETERMINE DOMAIN CONTEXT
  const host = window.location.hostname;
  const isEmployeeDomain = host.includes("portal.make"); 
  const isAgentDomain = host.includes("agent") || host.includes("commission");

  // 2. Auth Listener (Just updates state, DOES NOT REDIRECT)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        await checkAccess(currentUser);
      } else {
        setUser(null);
        setLoading(false);
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
         // We allow the Portals to handle "access denied" internally now
         setUser(null);
      } else {
        const data = userDoc.data();
        const isGoogle = currentUser.providerData.some(p => p.providerId === 'google.com');
        if (!isGoogle && data.allowPassword !== true && data.role !== 'admin') {
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

  // --- HELPER: MAIN DASHBOARD PROTECTION ---
  // Only the Main Dashboard forces the Blue Login here.
  // Portals handle their own login internally.
  const DashboardGuard = ({ children }) => {
      if (!user) return <Login type="admin" />;
      return children;
  };

  return (
    <Routes>
      {/* --- PUBLIC ROUTES --- */}
      <Route path="/kiosk" element={<Kiosk />} />
      <Route path="/kiosk.html" element={<Kiosk />} />

      {/* --- ROOT PATH (Domain Aware) --- */}
      <Route path="/" element={
          isEmployeeDomain ? <EmployeePortal /> :
          isAgentDomain ? <AgentPortal /> :
          <DashboardGuard><Dashboard /></DashboardGuard>
      } />

      {/* --- DIRECT PORTAL ACCESS --- */}
      <Route path="/employee-portal" element={<EmployeePortal />} />
      <Route path="/EmployeePortal" element={<EmployeePortal />} />
      
      <Route path="/agent-portal" element={<AgentPortal />} />
      <Route path="/AgentPortal" element={<AgentPortal />} />

      {/* --- PROTECTED DASHBOARD ROUTES --- */}

      <Route path="/dashboard.html" element={<DashboardGuard><Dashboard /></DashboardGuard>} />
      <Route path="/admin" element={<DashboardGuard><Admin /></DashboardGuard>} />
      <Route path="/agent-management" element={<DashboardGuard><AgentManagement /></DashboardGuard>} />
      <Route path="/bonuses" element={<DashboardGuard><Bonuses /></DashboardGuard>} />
      <Route path="/bonus-reports" element={<DashboardGuard><BonusReports /></DashboardGuard>} />
      <Route path="/commisions" element={<DashboardGuard><Commisions /></DashboardGuard>} /> 
      
      <Route path="/manual-ingest" element={<DashboardGuard><ManualIngest /></DashboardGuard>} />
      <Route path="/manual_ingest" element={<DashboardGuard><ManualIngest /></DashboardGuard>} />
      <Route path="/production-input" element={<DashboardGuard><ProductionInput /></DashboardGuard>} />
      <Route path="/ProjectOptions" element={<DashboardGuard><ProjectOptions /></DashboardGuard>} />
<Route path="/Project-Options" element={<DashboardGuard><ProjectOptions /></DashboardGuard>} />
      <Route path="/finance-input" element={<DashboardGuard><FinanceInput /></DashboardGuard>} />
      <Route path="/financial-report" element={<DashboardGuard><FinancialReport /></DashboardGuard>} />
      <Route path="/FinancialReport" element={<DashboardGuard><FinancialReport /></DashboardGuard>} />
      <Route path="/FinanceSetup" element={<DashboardGuard><FinanceSetup /></DashboardGuard>} />
<Route path="/Finance-Setup" element={<DashboardGuard><FinanceSetup /></DashboardGuard>} />
      <Route path="/iPad/:id" element={<DashboardGuard><IpadControl /></DashboardGuard>} />
      <Route path="/ipad-control/:id" element={<DashboardGuard><IpadControl /></DashboardGuard>} />
      <Route path="/project-search" element={<DashboardGuard><ProjectSearch /></DashboardGuard>} />
      <Route path="/upload" element={<DashboardGuard><ArchiveUpload /></DashboardGuard>} />
      <Route path="/staff-management" element={<DashboardGuard><StaffManagement /></DashboardGuard>} />
      <Route path="/StaffManagement" element={<DashboardGuard><StaffManagement /></DashboardGuard>} />
      <Route path="/project-summary" element={<DashboardGuard><ProjectSummary /></DashboardGuard>} />
      <Route path="/ProjectSummary" element={<DashboardGuard><ProjectSummary /></DashboardGuard>} />
      <Route path="/upcoming-projects" element={<DashboardGuard><UpcomingProjects /></DashboardGuard>} />
      <Route path="/UpcomingProjects" element={<DashboardGuard><UpcomingProjects /></DashboardGuard>} />
      <Route path="/workers" element={<DashboardGuard><Workers /></DashboardGuard>} />
      <Route path="/AgentReports" element={<DashboardGuard><AgentReports /></DashboardGuard>} />
      <Route path="/agent-reports" element={<DashboardGuard><AgentReports /></DashboardGuard>} />

      <Route path="/logout" element={<Logout />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;