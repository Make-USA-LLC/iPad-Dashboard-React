import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './BonusReports.css';
import { calculateBonuses, getPayDate, getWorkWeekFromPayDate, sanitize } from './calculations/bonuses';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const BonusReports = () => {
    const navigate = useNavigate();
    const [reportsCache, setReportsCache] = useState([]);
    const [workersDir, setWorkersDir] = useState([]);
    const [processedData, setProcessedData] = useState([]);
    const [config, setConfig] = useState({});
    
    // Filters
    const [periodOptions, setPeriodOptions] = useState([]);
    const [selectedPeriod, setSelectedPeriod] = useState('');
    const [employeeOptions, setEmployeeOptions] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [isAllTime, setIsAllTime] = useState(false);
    const [isFormerMode, setIsFormerMode] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                loadUserData(user, () => {
                    loadInitData();
                });
            } else {
                navigate('/');
            }
        });
        return () => unsubscribe();
    }, []);

    const loadInitData = async () => {
        // 1. Config
        const cSnap = await getDoc(doc(db, "config", "finance"));
        if(cSnap.exists()) setConfig(cSnap.data());

        // 2. Workers
        const wSnap = await getDocs(collection(db, "workers"));
        const dir = [];
        wSnap.forEach(d => {
            const w = d.data();
            const fullName = w.name || `${w.firstName} ${w.lastName}`;
            dir.push({ fullName, lastName: w.lastName || '' });
        });
        setWorkersDir(dir);

        // 3. Paid Reports
        const q = query(collection(db, "reports"), where("financeStatus", "==", "complete"));
        const snap = await getDocs(q);
        const list = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.bonusPaid === true || data.bonusEligible === false) {
                list.push({ id: d.id, ...data });
            }
        });
        setReportsCache(list);

        // 4. Build Dropdowns
        buildPeriodDropdown(list);
    };

    // Rebuild Employee Dropdown whenever Reports or Mode changes
    useEffect(() => {
        buildEmployeeDropdown(reportsCache, workersDir);
    }, [reportsCache, workersDir, isFormerMode]);

    const buildPeriodDropdown = (list) => {
        const map = new Map();
        list.forEach(r => {
            const payStr = getPayDate(r);
            const weekData = getWorkWeekFromPayDate(payStr);
            if(!map.has(weekData.start)) {
                map.set(weekData.start, { val: weekData.start, label: weekData.label });
            }
        });
        const sorted = Array.from(map.values()).sort((a,b) => b.val - a.val);
        setPeriodOptions(sorted);
        if(sorted.length > 0) setSelectedPeriod(sorted[0].val); 
    };

    const buildEmployeeDropdown = (list, dir) => {
        const names = new Set();
        list.forEach(r => {
            if(r.leader) names.add(r.leader.trim());
            if(r.workerLog) r.workerLog.forEach(w => names.add(w.name.trim()));
        });
        
        const activeList = [];
        const formerList = [];

        names.forEach(name => {
            const sName = sanitize(name);
            const match = dir.find(w => sanitize(w.fullName) === sName);
            
            if (match) {
                const niceName = match.fullName;
                if (!activeList.some(item => item.name === niceName)) {
                    activeList.push({ name: niceName, sortKey: match.lastName });
                }
            } else {
                formerList.push({ name: name, sortKey: name });
            }
        });

        const listToShow = isFormerMode ? formerList : activeList;
        listToShow.sort((a,b) => a.sortKey.localeCompare(b.sortKey));
        setEmployeeOptions(listToShow);
    };

    // Run Filter Logic
    useEffect(() => {
        if(reportsCache.length === 0) return;

        let filtered = reportsCache;

        // Date Filter
        if (!isAllTime && selectedPeriod) {
            filtered = filtered.filter(r => {
                const payStr = getPayDate(r);
                const weekData = getWorkWeekFromPayDate(payStr);
                return weekData.start === parseInt(selectedPeriod);
            });
        }

        // Employee Filter logic is handled inside calculateBonuses via 'selectedEmployee'
        const result = calculateBonuses(filtered, config, workersDir, selectedEmployee);
        setProcessedData(result);

    }, [selectedPeriod, selectedEmployee, isAllTime, reportsCache, config, workersDir]);

    const handleExportCSV = () => {
        if(!processedData || processedData.length === 0) return alert("No data to export");
        
        const headers = ["Report ID","Employee","Pay Date","Work Date","Project","Company","Leader","Role","Hours","Invoice Amt","Agent","Bonus Amount","Custom Override","Status","Reason"];
        let csvRows = [];
        csvRows.push(headers.join(","));
        
        processedData.forEach(emp => {
            emp.items.forEach(i => {
                const status = i.isIneligible ? "NOT ELIGIBLE" : "PAID";
                const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
                
                const row = [
                    escape(i.id), escape(emp.name), escape(i.payDate), escape(i.originalDate),
                    escape(i.project), escape(i.company), escape(i.leader), escape(i.role),
                    escape(i.hours.toFixed(2)), escape((i.invoice || 0).toFixed(2)), escape(i.agent),
                    escape(i.amount.toFixed(2)), escape(i.isCustom ? "Yes" : "No"), escape(status), escape(i.reason)
                ];
                csvRows.push(row.join(","));
            });
        });

        const csvString = "\uFEFF" + csvRows.join("\n"); 
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "bonus_export.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleLogout = () => signOut(auth).then(() => navigate('/'));

    const grandTotal = processedData.reduce((acc, curr) => acc + curr.total, 0);

    return (
        <div className="reports-page-wrapper">
            <div className="reports-top-bar">
                <button onClick={() => navigate('/')} style={{border:'none', background:'none', fontWeight:'bold', cursor:'pointer'}}>&larr; Dashboard</button>
                <div style={{fontWeight:'bold'}}>Bonus Reports</div>
                <button onClick={handleLogout} style={{color:'#e74c3c', border:'none', background:'none', fontWeight:'bold', cursor:'pointer'}}>Sign Out</button>
            </div>

            <div className="reports-container">
                <div className="control-panel">
                    <div className="control-row">
                        <div className="input-group">
                            <label>Timeframe (Work Week)</label>
                            <div style={{display:'flex', gap:'5px'}}>
                                <select className="report-select" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)} disabled={isAllTime}>
                                    {periodOptions.map(p => <option key={p.val} value={p.val}>{p.label}</option>)}
                                </select>
                                <button className={`btn btn-toggle ${isAllTime?'active':''}`} onClick={() => setIsAllTime(!isAllTime)}>
                                    All Time
                                </button>
                            </div>
                        </div>
                        <div className="input-group">
                            <label>{isFormerMode ? "Select Former Employee" : "Select Active Employee"}</label>
                            <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
                                <select className="report-select" value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)}>
                                    <option value="">-- Show All --</option>
                                    {employeeOptions.map((e, i) => <option key={i} value={e.name}>{e.name}</option>)}
                                </select>
                                <label className="checkbox-wrapper">
                                    <input type="checkbox" checked={isFormerMode} onChange={e => setIsFormerMode(e.target.checked)} />
                                    <span style={{fontSize:'13px'}}>Former?</span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="control-row" style={{justifyContent:'flex-end'}}>
                        <button className="btn btn-csv" onClick={handleExportCSV}>
                            <span className="material-icons">download</span> Export CSV
                        </button>
                        <button className="btn btn-print" onClick={() => window.print()}>
                            <span className="material-icons">print</span> Print Slips
                        </button>
                    </div>
                </div>

                <div className="summary-card" style={{display: processedData.length > 0 ? 'flex' : 'none'}}>
                    <div>
                        <h2 style={{margin:0, fontSize:'32px'}}>${grandTotal.toLocaleString(undefined, {minimumFractionDigits:2})}</h2>
                        <div style={{opacity:0.8}}>Total Payout</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'24px', fontWeight:'bold'}}>{processedData.length}</div>
                        <div style={{opacity:0.8}}>Employees</div>
                    </div>
                </div>

                <div className="slip-container">
                    {processedData.length === 0 && <div style={{textAlign:'center', color:'#999', padding:'40px'}}>No records found.</div>}
                    
                    {processedData.map((emp, i) => (
                        <div key={i} className="pay-slip">
                            <div className="slip-header-top">
                                <div className="company-branding">
                                    <img src="https://makeit.buzz/wp-content/uploads/2024/06/Make-Logo-Black-E.png" class="company-logo" alt="MAKE USA" />
                                    <div className="company-details">
                                        <strong>Make USA LLC</strong><br/>
                                        340 13th Street<br/>
                                        Carlstadt, NJ 07072
                                    </div>
                                </div>
                                <div className="period-box">
                                    <div className="period-label">PAY DATE</div>
                                    <div className="period-date">{emp.items[0]?.payDate || 'N/A'}</div>
                                </div>
                            </div>

                            <div className="emp-section">
                                <div className="emp-name">{emp.name}</div>
                            </div>

                            <table className="slip-table">
                                <thead>
                                    <tr>
                                        <th>Run Date</th>
                                        <th>Pay Date</th>
                                        <th>Project / Client</th>
                                        <th>Role</th>
                                        <th style={{textAlign:'right'}}>Hours</th>
                                        <th style={{textAlign:'right'}}>Bonus</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {emp.items.map((item, ix) => (
                                        <tr key={ix}>
                                            <td>{item.originalDate}</td>
                                            <td>{item.payDate}</td>
                                            <td>
                                                <div style={{fontWeight:'bold'}}>{item.project}</div>
                                                <div style={{color:'#666'}}>{item.company}</div>
                                                {item.isIneligible && <div style={{fontSize:'11px', color:'#c0392b', fontStyle:'italic'}}>Reason: {item.reason}</div>}
                                            </td>
                                            <td><span className="role-badge">{item.role}</span></td>
                                            <td style={{textAlign:'right'}}>{item.hours.toFixed(1)}</td>
                                            <td style={{textAlign:'right', fontWeight:'bold'}}>
                                                {item.isCustom && <span style={{color:'blue'}}>* </span>}
                                                {item.isIneligible ? <span className="ineligible-badge">NOT ELIGIBLE</span> : `$${item.amount.toFixed(2)}`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="total-row">
                                <div className="total-box">
                                    <div style={{fontSize:'10px', color:'#666', textTransform:'uppercase'}}>Total Payment</div>
                                    <div style={{fontSize:'20px', fontWeight:'bold', color:'#27ae60', fontFamily:'monospace'}}>${emp.total.toFixed(2)}</div>
                                </div>
                            </div>
                            <div className="cut-line"></div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default BonusReports;