import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import './FinancialReport.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

const FinancialReport = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [reports, setReports] = useState([]);
    const [config, setConfig] = useState({ costPerHour: 0, agents: [] });
    const [timeRange, setTimeRange] = useState('30');
    const [hasAccess, setHasAccess] = useState(false);

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
        if (!uSnap.exists()) return navigate('/');
        const role = uSnap.data().role;

        const rolesSnap = await getDoc(doc(db, "config", "roles"));
        let allowed = false;
        if (role === 'admin') allowed = true;
        else if (rolesSnap.exists()) {
            const rc = rolesSnap.data()[role];
            if (rc && (rc['finance_view'] || rc['admin_view'])) allowed = true;
        }

        if (allowed) {
            setHasAccess(true);
            await loadConfig();
        } else {
            setLoading(false);
        }
    };

    const loadConfig = async () => {
        try {
            const cSnap = await getDoc(doc(db, "config", "finance"));
            if (cSnap.exists()) {
                const d = cSnap.data();
                setConfig({
                    costPerHour: parseFloat(d.costPerHour) || 0,
                    agents: d.agents || []
                });
            }
        } catch(e) { console.error(e); }
    };

    useEffect(() => {
        if(hasAccess) fetchReports();
    }, [timeRange, hasAccess]);

    const fetchReports = async () => {
        setLoading(true);
        try {
            let q;
            if (timeRange === 'all') {
                q = query(collection(db, "reports"), orderBy("completedAt", "desc"));
            } else {
                const days = parseInt(timeRange);
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - days);
                q = query(
                    collection(db, "reports"), 
                    where("completedAt", ">=", cutoff), 
                    orderBy("completedAt", "desc")
                );
            }

            const snap = await getDocs(q);
            const list = [];
            snap.forEach(d => {
                list.push({ id: d.id, ...d.data() });
            });
            setReports(list);
        } catch(e) { console.error(e); }
        setLoading(false);
    };

    const handleExport = () => {
        const exportData = reports.map(calcRowData);
        
        const flatData = exportData.map(r => ({
            "Rec Price": r.isComplete ? r.recPrice : '',
            "Leader": r.leader,
            "Date": r.dateDisplay,
            "Customer": r.company,
            "PL#": r.plNumber,
            "Desc": r.financeDesc,
            "Labor HRS": r.isComplete ? r.laborHrs.toFixed(2) : '',
            "Cost": r.isComplete ? r.cost : '',
            "Inv $": r.isComplete ? r.inv : '',
            "Units": r.isComplete ? r.units : '',
            "Sec/Unit": r.isComplete ? r.secPerUnit : '',
            "Comm": r.isComplete ? r.commAmount : '',
            "Agent": r.agentName,
            "Profit $": r.isComplete ? r.profit : '',
            "Profit %": r.isComplete ? (r.profitPercent.toFixed(0) + '%') : '',
            "Type": r.projectType
        }));

        const ws = XLSX.utils.json_to_sheet(flatData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Financial Report");
        XLSX.writeFile(wb, `Financial_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
    };

    const calcRowData = (data) => {
        const isComplete = data.financeStatus === "complete";
        const dateDisplay = data.completedAt?.seconds ? new Date(data.completedAt.seconds*1000).toLocaleDateString() : "N/A";
        
        if (!isComplete) return { isComplete: false, data, dateDisplay, leader: data.leader, company: data.company, project: data.project };

        const orig = Number(data.originalSeconds) || 0;
        const final = Number(data.finalSeconds) || 0;
        const laborHrs = (orig > 0) ? (orig - final) / 3600 : 0;
        const secondsSpent = orig - final;
        
        const cost = laborHrs * config.costPerHour;
        const inv = Number(data.invoiceAmount) || 0;
        const units = Number(data.totalUnits) || 1;
        const secPerUnit = (units > 0 && secondsSpent > 0) ? (secondsSpent / units) : 0;

        let commAmount = 0;
        if(data.agentName && config.agents.length > 0) {
            const agent = config.agents.find(a => a.name === data.agentName);
            if(agent) {
                const excluded = Number(data.commissionExcluded) || 0;
                const basis = Math.max(0, inv - excluded);
                commAmount = basis * (agent.comm / 100);
            }
        }

        const profit = inv - cost - commAmount;
        const profitPercent = inv > 0 ? (profit / inv) * 100 : 0;
        const recPrice = units > 0 ? (cost / units) : 0;

        return {
            isComplete: true,
            leader: data.leader,
            dateDisplay,
            company: data.company,
            plNumber: data.plNumber,
            financeDesc: data.financeDesc || data.project,
            laborHrs,
            cost,
            inv,
            units,
            secPerUnit,
            commAmount,
            agentName: data.agentName,
            profit,
            profitPercent,
            projectType: data.projectType,
            recPrice
        };
    };

    if (!hasAccess && !loading) return <div className="fr-denied">⛔ ACCESS DENIED</div>;

    const fmt = (n) => (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const fmtN = (n) => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

    return (
        <div className="fr-wrapper">
            <div className="fr-top-bar">
                <button onClick={() => navigate('/')} style={{background:'none', border:'none', cursor:'pointer', fontSize:'14px', fontWeight:'bold', color:'#333'}}>
                    &larr; Dashboard
                </button>
                
                <div style={{display:'flex', alignItems:'center', gap:'5px'}}>
                    <span>Time Range:</span>
                    <select className="fr-select" value={timeRange} onChange={e => setTimeRange(e.target.value)}>
                        <option value="30">Last 30 Days</option>
                        <option value="60">Last 60 Days</option>
                        <option value="90">Last 90 Days</option>
                        <option value="365">Last 365 Days</option>
                        <option value="all">All Time</option>
                    </select>
                </div>

                <div style={{fontWeight:'bold', color:'#555'}}>
                    Records: <span className="badge">{reports.length}</span>
                </div>

                <button className="fr-btn btn-excel" onClick={handleExport}>Export Excel</button>
                <button className="fr-btn btn-print" onClick={() => window.print()}>Print / PDF</button>
            </div>

            <div className="fr-table-container">
                {loading ? <div className="fr-loading">Loading Report Data...</div> : (
                    <table className="fr-table">
                        <thead>
                            <tr>
                                <th className="bg-green">Rec Price</th>
                                <th className="bg-yellow">Line Leader</th>
                                <th className="bg-yellow">Date</th>
                                <th className="bg-yellow">Customer</th>
                                <th className="bg-yellow">PL#</th>
                                <th className="bg-yellow">Desc</th>
                                <th className="bg-yellow">Labor HRS</th>
                                <th className="bg-yellow">Cost</th>
                                <th className="bg-yellow">Inv $</th>
                                <th className="bg-yellow">Units</th>
                                <th className="bg-yellow">Sec/Unit</th>
                                <th className="bg-yellow">Comm.</th>
                                <th className="bg-yellow">Agent</th>
                                <th className="bg-blue">P/L $</th>
                                <th className="bg-blue">P/L %</th>
                                <th className="bg-blue">Type</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reports.map(raw => {
                                const r = calcRowData(raw);
                                
                                if (!r.isComplete) {
                                    return (
                                        <tr key={raw.id}>
                                            <td>--</td>
                                            <td>{r.leader || '-'}</td>
                                            <td>{r.dateDisplay}</td>
                                            <td>{r.company || '-'}</td>
                                            <td colSpan="12" className="bg-pending">⚠ PENDING INPUT: {r.project}</td>
                                        </tr>
                                    );
                                }

                                return (
                                    <tr key={raw.id}>
                                        <td className="align-right">{fmt(r.recPrice)}</td>
                                        <td>{r.leader}</td>
                                        <td>{r.dateDisplay}</td>
                                        <td>{r.company}</td>
                                        <td>{r.plNumber}</td>
                                        <td className="align-left">{r.financeDesc}</td>
                                        <td>{r.laborHrs.toFixed(2)}</td>
                                        <td className="align-right">{fmt(r.cost)}</td>
                                        <td className="align-right">{fmt(r.inv)}</td>
                                        <td>{fmtN(r.units)}</td>
                                        <td>{fmtN(r.secPerUnit)}</td>
                                        <td className="align-right">{r.commAmount > 0 ? fmt(r.commAmount) : '-'}</td>
                                        <td>{r.agentName || '-'}</td>
                                        <td className={`align-right ${r.profit < 0 ? 'bg-red-cell' : ''}`}>{fmt(r.profit)}</td>
                                        <td className={r.profit < 0 ? 'bg-red-cell' : ''}>{r.profitPercent.toFixed(0)}%</td>
                                        <td>{r.projectType}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default FinancialReport;