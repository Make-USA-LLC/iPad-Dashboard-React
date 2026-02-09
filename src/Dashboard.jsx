import React, { useState, useEffect, useRef } from 'react';
import './Dashboard.css';
import Sortable from 'sortablejs';
import { useNavigate } from 'react-router-dom'; 
import { db, auth, loadUserData, newIpadDefaults } from './firebase_config'; // Ensure path is correct
import { 
  doc, 
  collection, 
  onSnapshot, 
  serverTimestamp, 
  setDoc, 
  deleteDoc, 
  getDoc 
} from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const Dashboard = () => {
  const navigate = useNavigate(); 
  
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('');
  const [rolesConfig, setRolesConfig] = useState({});
  const [liveIpads, setLiveIpads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newIpadId, setNewIpadId] = useState('');
  const [now, setNow] = useState(Date.now()); 

  const gridRef = useRef(null);
  const sortableInstance = useRef(null);

  // 1. Auth & Initial Load
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        loadUserData(currentUser, async () => {
           await fetchPermissions(currentUser);
           setLoading(false);
        });
      } else {
        window.location.href = 'index.html'; // Redirect if not logged in
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Fetch Permissions
  const fetchPermissions = async (currentUser) => {
    try {
      const uSnap = await getDoc(doc(db, "users", currentUser.email.toLowerCase()));
      if (uSnap.exists()) {
        const userRole = uSnap.data().role;
        setRole(userRole);
      }

      const rSnap = await getDoc(doc(db, "config", "roles"));
      if (rSnap.exists()) setRolesConfig(rSnap.data());
    } catch (e) {
      console.error("Perm fetch error", e);
    }
  };

  // 3. Permission Helper
  const hasPerm = (feature, type) => {
    if (!role) return false;
    if (role === 'admin') return true;

    const cleanUserRole = role.toLowerCase().replace(/[^a-z0-9]/g, '');
    let matchedRoleKey = null;
    const configKeys = Object.keys(rolesConfig);

    if (rolesConfig[role]) matchedRoleKey = role;
    else {
      for (const key of configKeys) {
        if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanUserRole) {
          matchedRoleKey = key;
          break;
        }
      }
    }

    if (!matchedRoleKey) return false;
    const roleData = rolesConfig[matchedRoleKey];
    const viewKey = feature + '_view';
    const editKey = feature + '_edit';
    const canView = roleData[viewKey] === true;
    const canEdit = roleData[editKey] === true;

    if (type === 'edit') return canEdit;
    if (type === 'view') return canView || canEdit;
    return false;
  };

  // 4. Live Data Listener (iPads)
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "ipads"), (snapshot) => {
      let ipads = [];
      snapshot.forEach((doc) => {
        ipads.push({ id: doc.id, ...doc.data() });
      });

      const storageKey = user ? `makeusa_layout_${user.email}` : 'layout_default';
      const savedOrder = JSON.parse(localStorage.getItem(storageKey));

      if (savedOrder && Array.isArray(savedOrder) && savedOrder.length > 0) {
        ipads.sort((a, b) => {
          const idxA = savedOrder.indexOf(a.id);
          const idxB = savedOrder.indexOf(b.id);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
      } else {
        ipads.sort((a, b) => {
            const getScore = (ipad) => {
                const lastHb = ipad.lastUpdateTime?.seconds * 1000 || 0;
                const isLive = (Date.now() - lastHb) < 75000;
                const hasProject = ipad.secondsRemaining !== 0; 
                const isPaused = ipad.isPaused;
                if (hasProject && !isPaused) return 4; 
                if (hasProject && isPaused) return 3; 
                if (isLive) return 2;
                return 1;
            };
            return getScore(b) - getScore(a);
        });
      }
      setLiveIpads(ipads);
    });
    return () => unsubscribe();
  }, [user]);

  // 5. Timer Interval
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // 6. Initialize SortableJS
  useEffect(() => {
    if (sortableInstance.current) return;

    if (gridRef.current && !loading) {
        sortableInstance.current = new Sortable(gridRef.current, {
            animation: 150,
            forceFallback: true, 
            fallbackClass: 'sortable-fallback',
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            delay: 0, 
            disabled: false,
            onEnd: () => {
                const order = Array.from(gridRef.current.children).map(card => card.getAttribute('data-id'));
                const storageKey = `makeusa_layout_${user?.email}`;
                localStorage.setItem(storageKey, JSON.stringify(order));
            }
        });
    }
    
    return () => {
       if (sortableInstance.current) {
           sortableInstance.current.destroy();
           sortableInstance.current = null;
       }
    };
  }, [loading]);

  const handleCreateIpad = async () => {
    if (!newIpadId.trim()) return alert("Enter ID");
    const data = { ...newIpadDefaults, lastUpdateTime: serverTimestamp() };
    try {
      await setDoc(doc(db, "ipads", newIpadId.trim()), data);
      navigate(`/ipad-control/${newIpadId.trim()}`);
      setNewIpadId('');
    } catch (error) {
      alert("Error creating iPad: " + error.message);
    }
  };

  const handleDeleteIpad = async (id, e) => {
    e.stopPropagation();
    if (window.confirm(`Delete ${id}? This cannot be undone.`)) {
      await deleteDoc(doc(db, "ipads", id));
    }
  };

  const handleLogout = () => {
    signOut(auth).then(() => navigate('/'));
  };

  const handleResetLayout = () => {
    const storageKey = `makeusa_layout_${user?.email}`;
    localStorage.removeItem(storageKey);
    window.location.reload(); 
  };

  const renderTimer = (ipad) => {
    let seconds = ipad.secondsRemaining || 0;
    if (!ipad.isPaused && ipad.lastUpdateTime && ipad.activeWorkers?.length > 0) {
        const lastUpdate = ipad.lastUpdateTime.seconds * 1000;
        const elapsedWallSecs = Math.floor((now - lastUpdate) / 1000);
        const burnRate = ipad.activeWorkers.length;
        seconds = seconds - (elapsedWallSecs * burnRate);
    }
    
    const isNeg = seconds < 0;
    const absSec = Math.abs(seconds);
    const h = Math.floor(absSec / 3600);
    const m = Math.floor((absSec % 3600) / 60);
    const s = Math.floor(absSec % 60);
    const fmt = (n) => n.toString().padStart(2, '0');
    return `${isNeg ? '-' : ''}${h}:${fmt(m)}:${fmt(s)}`;
  };

  if (loading) return <div className="loading">Loading...</div>;

  const canViewFinance = hasPerm('finance', 'view') || hasPerm('bonuses', 'view') || hasPerm('queue', 'edit') || hasPerm('admin', 'edit') || hasPerm('commissions', 'view');
  const canViewQueue = hasPerm('queue', 'view') || hasPerm('search', 'view') || hasPerm('summary', 'view');
  const canViewIpads = hasPerm('fleet', 'view') || hasPerm('timer', 'view');

  return (
    <div className="dashboard-layout">
      <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} id="mainSidebar">
        <div className="sidebar-header">
            <div className="logo-text">MAKE USA</div>
            <div style={{fontSize:'12px', color:'#7f8c8d', marginTop:'5px'}}>{user?.email}</div>
            <span className="user-role-badge">{role}</span>
        </div>

        <ul className="nav-list">
            <div className="section-header">Management</div>
            
            {hasPerm('admin', 'view') && (
                <li className="nav-item" onClick={() => navigate('/admin')}>
                    <div className="nav-item-main"><span className="material-icons">admin_panel_settings</span> Admin Panel</div>
                </li>
            )}
             {hasPerm('workers', 'view') && (
                <li className="nav-item" onClick={() => navigate('/workers')}>
                    <div className="nav-item-main"><span className="material-icons">people</span> Manage Workers</div>
                </li>
            )}
             {(hasPerm('admin', 'edit') || hasPerm('workers', 'edit')) && (
                <li className="nav-item" onClick={() => navigate('/staff-management')}>
                    <div className="nav-item-main"><span className="material-icons" style={{color:'#f39c12'}}>manage_accounts</span> Staff Access</div>
                </li>
            )}
             {(hasPerm('admin', 'edit') || hasPerm('finance', 'edit')) && (
                <li className="nav-item" onClick={() => navigate('/agent-management')}>
                    <div className="nav-item-main"><span className="material-icons" style={{color:'#8e44ad'}}>support_agent</span> Agent Management</div>
                </li>
            )}

            {/* FINANCE SECTION */}
            {canViewFinance && (
                <>
                    <div className="section-header">Finance & Reporting</div>
                    
                    {/* Manual Ingest */}
                    {(hasPerm('admin', 'edit') || hasPerm('queue', 'edit')) && (
                         <li className="nav-item" onClick={() => navigate('/manual-ingest')}>
                            <div className="nav-item-main"><span className="material-icons" style={{color:'#e74c3c'}}>playlist_add</span> Manual Ingest</div>
                        </li>
                    )}

                    {/* Production Input */}
                    {(hasPerm('queue', 'edit') || hasPerm('admin', 'edit')) && (
                         <li className="nav-item" onClick={() => navigate('/production-input')}>
                            <div className="nav-item-main"><span className="material-icons" style={{color:'#3498db'}}>input</span> Production Input</div>
                        </li>
                    )}

                    {/* Finance Input - Fixed Label */}
                    {hasPerm('finance', 'view') && (
                        <li className="nav-item" onClick={() => navigate('/finance-input')}>
                            <div className="nav-item-main">
                                <span className="material-icons" style={{color:'#f1c40f'}}>monetization_on</span> 
                                Finance Input
                            </div>
                        </li>
                    )}

                    {/* Financial Report */}
                    {hasPerm('finance', 'view') && (
                        <li className="nav-item" onClick={() => navigate('/financial-report')}>
                            <div className="nav-item-main"><span className="material-icons" style={{color:'#2ecc71'}}>assessment</span> Financial Report</div>
                        </li>
                    )}

                    {/* Bonuses */}
                    {hasPerm('bonuses', 'view') && (
                        <>
                            <li className="nav-item" onClick={() => navigate('/bonuses')}>
                                <div className="nav-item-main"><span className="material-icons" style={{color:'#9b59b6'}}>emoji_events</span> Bonuses</div>
                            </li>
                            <li className="nav-item" onClick={() => navigate('/bonus-reports')}>
                                <div className="nav-item-main"><span className="material-icons" style={{color:'#e91e63'}}>description</span> Bonus Reports</div>
                            </li>
                        </>
                    )}

                    {/* Commissions */}
                    {(hasPerm('commissions', 'view') || hasPerm('finance', 'view')) && (
                        <>
                            <li className="nav-item" onClick={() => navigate('/commissions')}>
                                <div className="nav-item-main"><span className="material-icons" style={{color:'#8e44ad'}}>pie_chart</span> Commissions</div>
                            </li>
                            <li className="nav-item" onClick={() => navigate('/agent-reports')}>
                                <div className="nav-item-main"><span className="material-icons" style={{color:'#e91e63'}}>summarize</span> Agent Reports</div>
                            </li>
                        </>
                    )}

                    {/* Finance Setup - Restored */}
                    {hasPerm('finance', 'edit') && (
                        <li className="nav-item" onClick={() => navigate('/finance-setup')}>
                            <div className="nav-item-main">
                                <span className="material-icons" style={{color:'#3498db'}}>settings</span> 
                                Finance Setup
                            </div>
                        </li>
                    )}
                </>
            )}

            {/* PROJECT ARCHIVE */}
            {hasPerm('search', 'view') && (
                <li className="nav-item" onClick={() => navigate('/project-search')}>
                    <div className="nav-item-main"><span className="material-icons" style={{color:'#e67e22'}}>history</span> Project Archive</div>
                </li>
            )}

            {/* QUEUE SECTION */}
            {canViewQueue && (
                <>
                    <div className="section-header">Production Planning</div>
                    {hasPerm('queue', 'view') && (
                         <li className="nav-item" onClick={() => navigate('/upcoming-projects')}>
                            <div className="nav-item-main"><span className="material-icons" style={{color:'#3498db'}}>queue</span> Project Queue</div>
                        </li>
                    )}
                     {hasPerm('summary', 'view') && (
                         <li className="nav-item" onClick={() => navigate('/project-summary')}>
                            <div className="nav-item-main"><span className="material-icons" style={{color:'#8e44ad'}}>summarize</span> Production Summary</div>
                        </li>
                    )}
                    {hasPerm('queue', 'edit') && (
                            <li className="nav-item" onClick={() => navigate('/project-options')}>
                            <div className="nav-item-main"><span className="material-icons" style={{color:'#16a085'}}>list_alt</span> Edit Dropdowns</div>
                        </li>
                    )}
                </>
            )}
            
            {/* IPAD SIDEBAR LIST */}
            {canViewIpads && (
                <>
                    <div className="section-header">Production iPads</div>
                    {liveIpads.map(ipad => {
                        const lastHb = ipad.lastUpdateTime?.seconds * 1000 || 0;
                        const isLive = (Date.now() - lastHb < 75000);
                        return (
                            <li key={ipad.id} className="nav-item">
                                <div className="nav-item-main" onClick={() => navigate(`/ipad-control/${ipad.id}`)}>
                                    <span className={`status-dot ${isLive ? 'dot-green' : 'dot-gray'}`}></span>
                                    <span style={{fontWeight:500}}>{ipad.id}</span>
                                </div>
                                <div className="action-group">
                                    <span className="material-icons icon-btn" onClick={() => navigate(`/ipad-control/${ipad.id}`)}>edit</span>
                                    {hasPerm('fleet', 'edit') && (
                                        <span className="material-icons icon-btn delete" onClick={(e) => handleDeleteIpad(ipad.id, e)}>delete</span>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </>
            )}
        </ul>

        <div className="sidebar-footer">
            {hasPerm('fleet', 'edit') && (
                <div className="control-stack">
                    <input 
                        type="text" 
                        value={newIpadId}
                        onChange={(e) => setNewIpadId(e.target.value)}
                        className="login-input" 
                        style={{background:'#1a252f', borderColor:'#2c3e50', color:'white'}} 
                        placeholder="New iPad ID" 
                    />
                    <button className="btn-green" onClick={handleCreateIpad}>+ Add iPad</button>
                </div>
            )}
            <button className="btn-red-outline" onClick={handleLogout}>Sign Out</button>
        </div>
      </div>

      <div className="main-content">
        <div className="top-bar">
            <div style={{display:'flex', alignItems:'center'}}>
                <span className="material-icons mobile-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>menu</span>
                <h1 style={{margin:0, fontSize: '20px', color:'#2c3e50'}}>iPad Dashboard</h1>
            </div>
            {hasPerm('timer', 'view') && (
                <button className="btn-small" onClick={handleResetLayout}>Reset View</button>
            )}
        </div>

        <div className="content-area">
            {liveIpads.length === 0 && (
                <div className="empty-state">
                    <span className="material-icons" style={{fontSize: '60px'}}>device_hub</span>
                    <h1>Production Command</h1>
                    <p>Select an iPad from the menu to view status.</p>
                </div>
            )}

            <div id="ipadGrid" className="ipad-grid" ref={gridRef} style={{display: liveIpads.length > 0 ? 'grid' : 'none'}}>
                {liveIpads.map(ipad => {
                     const isActive = ipad.secondsRemaining !== 0;
                     const isPaused = ipad.isPaused === true;
                     
                     let statusClass = 'st-idle';
                     let statusText = 'IDLE';
                     let timerClass = 'timer-idle'; // Default to Gray/Idle

                     if (isActive) {
                         if (isPaused) {
                             statusClass = 'st-paused';
                             statusText = 'PAUSED';
                             timerClass = 'timer-paused'; // Yellow
                         } else {
                             statusClass = 'st-active';
                             statusText = 'RUNNING';
                             timerClass = 'timer-running'; // Green
                         }
                     }

                     return (
                        <div key={ipad.id} className="ipad-card" data-id={ipad.id} onClick={(e) => {
                             if (!e.currentTarget.classList.contains('sortable-drag')) navigate(`/ipad-control/${ipad.id}`);
                        }}>
                             <div className="card-header">
                                <div className="card-id">{ipad.id}</div>
                                <div className={`card-status ${statusClass}`}>{statusText}</div>
                            </div>
                            <div className="card-body">
                                <div className="card-company">{ipad.companyName || 'No Company'}</div>
                                <div className="card-project" title={ipad.projectName}>{ipad.projectName || 'No Project'}</div>
                                <hr style={{border:0, borderTop:'1px solid #eee', margin:'10px 0'}} />
                                <div className="card-stat-row">
                                    <span className="stat-label">Line Leader</span>
                                    <span className="stat-val">{ipad.lineLeaderName || '-'}</span>
                                </div>
                                <div className="card-stat-row">
                                    <span className="stat-label">Clocked In</span>
                                    <span className="stat-val">{ipad.activeWorkers ? ipad.activeWorkers.length : 0}</span>
                                </div>
                            </div>
                            <div className={`card-timer ${timerClass}`}>
                                {renderTimer(ipad)}
                            </div>
                        </div>
                      );
                })}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;