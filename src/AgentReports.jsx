import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import './AgentReports.css';
import { db, auth, loadUserData, checkPermission } from './firebase_config'; // Adjust path
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const AgentReports = () => {
    const navigate = useNavigate();
    
    // State
    const [loading, setLoading] = useState(true);
    const [accessDenied, setAccessDenied] = useState(false);
    const [allReports, setAllReports] = useState([]);
    const [config, setConfig] = useState({});
    
    // Filters
    const [selectedPeriod, setSelectedPeriod] = useState('');
    const [selectedAgent, setSelectedAgent] = useState('');
    const [isAllTime, setIsAllTime] = useState(false);

    // Derived Data for Dropdowns
    const [periods, setPeriods] = useState([]);
    const [agents, setAgents] = useState([]);

    // 1. Auth & Initial Load
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                loadUserData(user, async () => {
                    const hasAccess = checkPermission('commissions', 'view') || checkPermission('admin', 'view');
                    if (hasAccess) {
                        await loadConfig();
                        await initData();
                    } else {
                        setAccessDenied(true);
                    }
                    setLoading(false);
                });
            } else {
                navigate('/'); // Redirect to login
            }
        });
        return () => unsubscribe();
    }, []);

    const loadConfig = async () => {
        try {
            const cSnap = await getDoc(doc(db, "config", "finance"));
            if (cSnap.exists()) setConfig(cSnap.data());
        } catch (e) {
            console.error("Config Error", e);
        }
    };

    const initData = async () => {
        try {
            const q = query(collection(db, "reports"), where("financeStatus", "==", "complete"));
            const snap = await getDocs(q);
            
            const reports = [];
            const periodSet = new Set();
            const agentSet = new Set();

            snap.forEach(d => {
                const data = d.data();
                if (data.agentName) {
                    reports.push({ id: d.id, ...data });
                    agentSet.add(data.agentName);
                    
                    if (data.completedAt) {
                        const date = new Date(data.completedAt.seconds * 1000);
                        const key = `${date.getMonth() + 1}/${date.getFullYear()}`; // "12/2025"
                        const sortVal = date.getFullYear() * 100 + date.getMonth(); 
                        const label = date.toLocaleDateString(undefined, {month:'long', year:'numeric'});
                        periodSet.add(JSON.stringify({ key, sortVal, label }));
                    }
                }
            });

            setAllReports(reports);

            // Process Dropdowns
            const pArray = Array.from(periodSet).map(JSON.parse).sort((a,b) => b.sortVal - a.sortVal);
            setPeriods(pArray);
            if(pArray.length > 0) setSelectedPeriod(pArray[0].key); // Default to latest

            const aArray = Array.from(agentSet).sort();
            setAgents(aArray);

        } catch (e) {
            console.error("Data Load Error", e);
            alert("Error loading report data.");
        }
    };

    // 2. Filter & Calculate Data (Memoized)
    const { reportGroups, grandTotal, totalCount, processedData } = useMemo(() => {
        let filtered = allReports.filter(r => {
            if (selectedAgent && r.agentName !== selectedAgent) return false;
            
            if (!isAllTime) {
                if (!r.completedAt) return false;
                const d = new Date(r.completedAt.seconds * 1000);
                const key = `${d.getMonth() + 1}/${d.getFullYear()}`;
                if (key !== selectedPeriod) return false;
            }
            return true;
        });

        // Group by Agent
        const groups = {};
        let gTotal = 0;
        let count = 0;
        const csvData = [];

        filtered.forEach(item => {
            if (!groups[item.agentName]) groups[item.agentName] = [];
            
            // Calculate Commission
            let rate = 0;
            if (config.agents) {
                const ag = config.agents.find(a => a.name === item.agentName);
                if (ag) rate = parseFloat(ag.comm);
            }

            const invoice = item.invoiceAmount || 0;
            const excluded = item.commissionExcluded || 0;
            const basis = Math.max(0, invoice - excluded);
            const rawComm = basis * (rate / 100);
            const commAmt = Math.round(rawComm * 100) / 100; // Rounding fix

            const processedItem = { ...item, commAmt, rate, invoice, excluded };
            groups[item.agentName].push(processedItem);
            
            gTotal += commAmt;
            count++;

            // Prepare CSV row
            csvData.push({
                Agent: item.agentName,
                Date: item.completedAt ? new Date(item.completedAt.seconds * 1000).toLocaleDateString() : '-',
                Project: item.project,
                Company: item.company,
                Invoice: invoice,
                Excluded: excluded,
                Rate: rate + '%',
                Commission: commAmt
            });
        });

        return { 
            reportGroups: groups, 
            grandTotal: gTotal, 
            totalCount: count,
            processedData: csvData
        };

    }, [allReports, selectedAgent, selectedPeriod, isAllTime, config]);

    // 3. Actions
    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    const handleExportCSV = () => {
        if(processedData.length === 0) return alert("No data to export");
        const ws = XLSX.utils.json_to_sheet(processedData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Commissions");
        XLSX.writeFile(wb, "Agent_Commissions_Export.xlsx");
    };

    const getPeriodLabel = () => {
        if(isAllTime) return "ALL TIME HISTORY";
        const p = periods.find(x => x.key === selectedPeriod);
        return p ? p.label : selectedPeriod;
    };

    if (loading) return <div className="ar-wrapper"><div className="ar-empty-state">Loading...</div></div>;
    if (accessDenied) return <div className="ar-wrapper"><div className="ar-empty-state">⛔ Access Denied</div></div>;

    return (
        <div className="ar-wrapper">
            <div className="ar-top-bar">
                <div 
                    onClick={() => navigate('/dashboard')} 
                    style={{cursor:'pointer', color:'#2c3e50', fontWeight:'bold', display:'flex', alignItems:'center', gap:'5px'}}
                >
                    <span className="material-icons">arrow_back</span> Dashboard
                </div>
                <div style={{fontWeight:'bold', color:'#8e44ad'}}>Agent Report Generator</div>
                <button onClick={handleLogout} className="btn-red-text">Sign Out</button>
            </div>

            <div className="ar-container">
                <div className="ar-control-panel">
                    <div className="ar-control-row">
                        <div className="ar-input-group">
                            <label>Report Month</label>
                            <div style={{display:'flex', gap:'5px'}}>
                                <select 
                                    className="ar-select"
                                    value={selectedPeriod} 
                                    onChange={(e) => setSelectedPeriod(e.target.value)}
                                    disabled={isAllTime}
                                    style={{opacity: isAllTime ? 0.5 : 1}}
                                >
                                    {periods.map(p => (
                                        <option key={p.key} value={p.key}>{p.label}</option>
                                    ))}
                                </select>
                                <button 
                                    className={`btn-toggle ${isAllTime ? 'active' : ''}`} 
                                    onClick={() => setIsAllTime(!isAllTime)}
                                >
                                    All Time
                                </button>
                            </div>
                        </div>

                        <div className="ar-input-group">
                            <label>Select Agent</label>
                            <select 
                                className="ar-select"
                                value={selectedAgent} 
                                onChange={(e) => setSelectedAgent(e.target.value)}
                            >
                                <option value="">-- All Agents --</option>
                                {agents.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="ar-control-row" style={{borderTop:'1px solid #eee', paddingTop:'15px', justifyContent:'flex-end', gap:'10px'}}>
                        <button className="btn btn-csv" onClick={handleExportCSV}>
                            <span className="material-icons">download</span> Export CSV
                        </button>
                        <button className="btn btn-print" onClick={() => window.print()}>
                            <span className="material-icons">print</span> Print Reports
                        </button>
                    </div>
                </div>

                <div className="ar-summary-card">
                    <div>
                        <h2 style={{margin:0, fontSize:'32px'}}>${grandTotal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</h2>
                        <div style={{opacity:0.8}}>Total Commissions</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'24px', fontWeight:'bold'}}>{totalCount}</div>
                        <div style={{opacity:0.8}}>Reports Generated</div>
                    </div>
                </div>

                <div className="ar-slip-container">
                    {Object.keys(reportGroups).length === 0 ? (
                        <div className="ar-empty-state">No records found for this selection.</div>
                    ) : (
                        Object.keys(reportGroups).sort().map(agentName => {
                            const items = reportGroups[agentName];
                            const agentTotal = items.reduce((sum, item) => sum + item.commAmt, 0);

                            return (
                                <div className="ar-pay-slip" key={agentName}>
                                    <div className="slip-header-top">
                                        <div className="company-branding">
                                            <img src="https://makeit.buzz/wp-content/uploads/2024/06/Make-Logo-Black-E.png" className="company-logo" alt="MAKE USA" />
                                            <div className="company-details">
                                                <strong>Make USA LLC</strong><br />
                                                340 13th Street<br />
                                                Carlstadt, NJ 07072
                                            </div>
                                        </div>
                                        <div className="period-box">
                                            <div className="period-label">REPORT PERIOD</div>
                                            <div className="period-date">{getPeriodLabel()}</div>
                                        </div>
                                    </div>

                                    <div className="emp-section">
                                        <div className="emp-name">{agentName}</div>
                                    </div>

                                    <table className="ar-table">
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Project / Client</th>
                                                <th style={{textAlign:'right'}}>Invoice Basis</th>
                                                <th style={{textAlign:'center'}}>Rate</th>
                                                <th style={{textAlign:'right'}}>Commission</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map(item => (
                                                <tr key={item.id}>
                                                    <td>{item.completedAt ? new Date(item.completedAt.seconds * 1000).toLocaleDateString() : '-'}</td>
                                                    <td>
                                                        <div style={{fontWeight:'bold'}}>{item.project}</div>
                                                        <div style={{color:'#666'}}>{item.company}</div>
                                                    </td>
                                                    <td style={{textAlign:'right'}}>
                                                        ${item.invoice.toLocaleString(undefined, {minimumFractionDigits:2})}
                                                        {item.excluded > 0 && (
                                                            <span className="excluded-text">(-${item.excluded.toLocaleString()})</span>
                                                        )}
                                                    </td>
                                                    <td style={{textAlign:'center'}}>
                                                        <span className="rate-badge">{item.rate}%</span>
                                                    </td>
                                                    <td style={{textAlign:'right', fontWeight:'bold'}}>
                                                        ${item.commAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    <div className="total-row">
                                        <div className="total-box">
                                            <div style={{fontSize:'10px', color:'#666', textTransform:'uppercase'}}>Total Payable</div>
                                            <div style={{fontSize:'20px', fontWeight:'bold', color:'#8e44ad', fontFamily:'monospace'}}>
                                                ${agentTotal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="cut-line"></div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default AgentReports;